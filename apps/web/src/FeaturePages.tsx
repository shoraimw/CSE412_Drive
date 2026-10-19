import {useEffect, useMemo, useRef, useState, type FormEvent} from "react";
import type {User} from "firebase/auth";
import type {ReactNode} from "react";
import {updateProfile} from "firebase/auth";
import {
  collection, doc, getDoc, getDocs, limit, onSnapshot, orderBy, query,
  serverTimestamp, updateDoc, where, type DocumentData
} from "firebase/firestore";
import {httpsCallable} from "firebase/functions";
import {ref as storageRef, uploadBytes} from "firebase/storage";
import {onValue, ref as rtdbRef, remove, set} from "firebase/database";
import {geohashForLocation} from "geofire-common";
import {auth, db, firebaseReady, functions, rtdb, storage} from "./firebase";
import {displayError, formatBdt, formatDistance, formatDuration, type RidePoint} from "./domain";

type Notice = (message: string) => void;
type Ride = {
  id: string; riderId?: string; riderIds?: string[]; driverId?: string | null;
  status?: string; vehicleType?: string; sharedRide?: boolean; sharedGroupId?: string;
  fare?: {totalMinor?: number}; finalFare?: {totalMinor?: number};
  fareShares?: Record<string, number>; currency?: string;
  createdAt?: {toDate?: () => Date}; completedAt?: {toDate?: () => Date};
  pickup?: RidePoint; destination?: RidePoint; routePolyline?: string;
  distanceMeters?: number; durationSeconds?: number;
};
type Contact = {contactId: string; name: string; phone: string; relationship: string; createdAtMs?: number | null};
type SafetyPreferences = {safetyMode: boolean; driverPreference: "any" | "verified_only"; shareTripByDefault: boolean; preferredContactIds: string[]};
type SharedGroup = {groupId: string; status: string; vehicleType: string; memberCount: number; maxPassengers: number; members: {uid: string; isYou: boolean; pickupLabel: string; destinationLabel: string}[]; leaderUid: string; totalEstimatedFareMinor: number; shareForCurrentUser: number | null; fareShares: Record<string, number>; expiresAtMs: number | null; rideId: string | null; provisional: boolean; note: string};
type TouristPlace = {placeId: string; name: string; address: string; lat: number; lng: number; types: string[]; rating?: number; reviewCount?: number};
type Vehicle = {id: string; model?: string; type?: string; area?: string; seatCount?: number; rentalRatePerHourMinor?: number; approvalStatus?: string; rentalEnabled?: boolean};
type RentalBooking = {id: string; vehicleId?: string; status?: string; startAt?: {toDate?: () => Date}; endAt?: {toDate?: () => Date}; totalMinor?: number; ownerId?: string; renterId?: string};
type DriverOffer = {id: string; rideId?: string; status?: string; pickup?: RidePoint; destination?: RidePoint; vehicleType?: string; estimatedFareMinor?: number; expiresAt?: {toDate?: () => Date}};
type DriverSummary = {verified: boolean; name: string; vehicleType: string; ratingAverage: number | null; note: string};
type Message = {id: string; senderId?: string; text?: string; createdAt?: {toDate?: () => Date}};

async function call<T>(name: string, data: Record<string, unknown> = {}): Promise<T> {
  if (!functions) throw new Error("Firebase is not configured for this deployment.");
  const result = await httpsCallable<Record<string, unknown>, T>(functions, name)(data);
  return result.data;
}

function Field({label, children}: {label: string; children: ReactNode}) {
  return <div className="field"><label>{label}</label>{children}</div>;
}

function SignedOut({onNeedAuth}: {onNeedAuth: () => void}) {
  return <div className="panel feature-empty"><div className="feature-icon">↗</div><h3>Sign in to continue</h3><p className="muted">Your private settings and trip details are available after authentication.</p><button className="button primary" onClick={onNeedAuth}>Sign in</button></div>;
}

export function SafetyPage({user, rides, onNeedAuth, onError, onNotice}: {
  user: User | null; rides: Ride[]; onNeedAuth: () => void; onError: Notice; onNotice: Notice;
}) {
  const [preferences, setPreferences] = useState<SafetyPreferences>({safetyMode: false, driverPreference: "any", shareTripByDefault: false, preferredContactIds: []});
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [relationship, setRelationship] = useState("Family");
  const [selectedRide, setSelectedRide] = useState("");
  const [shareLink, setShareLink] = useState("");
  const [shareExpires, setShareExpires] = useState("60");
  const activeRides = rides.filter(r => ["accepted", "driver_arriving", "in_progress"].includes(r.status || ""));
  useEffect(() => {
    if (!user) {setContacts([]);return;}
    let alive = true;
    setLoading(true);
    void call<{preferences: SafetyPreferences; contacts: Contact[]}>("getSafetyDashboard")
      .then(data => {if (alive) {setPreferences(data.preferences);setContacts(data.contacts || []);}})
      .catch(e => onError(displayError(e)))
      .finally(() => {if (alive) setLoading(false);});
    return () => {alive = false;};
  }, [user?.uid]);
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!user) {onNeedAuth();return;}
    setSaving(true);
    try {
      await call("saveSafetyPreferences", preferences as unknown as Record<string, unknown>);
      onNotice("Safety preferences saved. Verified-driver preference is a request, not a guarantee of availability.");
    } catch (e) {onError(displayError(e));}
    finally {setSaving(false);}
  }
  async function addContact(event: FormEvent) {
    event.preventDefault();
    if (!user) {onNeedAuth();return;}
    setSaving(true);
    try {
      await call("upsertTrustedContact", {name, phone, relationship});
      const data = await call<{preferences: SafetyPreferences; contacts: Contact[]}>("getSafetyDashboard");
      setContacts(data.contacts || []);
      setName("");setPhone("");
      onNotice("Trusted contact saved. DRIVE has not sent them a message.");
    } catch (e) {onError(displayError(e));}
    finally {setSaving(false);}
  }
  async function deleteContact(contactId: string) {
    setSaving(true);
    try {
      await call("deleteTrustedContact", {contactId});
      setContacts(old => old.filter(c => c.contactId !== contactId));
      setPreferences(old => ({...old, preferredContactIds: old.preferredContactIds.filter(id => id !== contactId)}));
      onNotice("Trusted contact removed.");
    } catch (e) {onError(displayError(e));}
    finally {setSaving(false);}
  }
  async function shareTrip() {
    if (!selectedRide) {onError("Choose an active trip first.");return;}
    setSaving(true);setShareLink("");
    try {
      const result = await call<{sharePath: string; expiresAtMs: number; note: string}>("createTripShare", {rideId: selectedRide, expiresInMinutes: Number(shareExpires)});
      const url = window.location.origin + result.sharePath;
      setShareLink(url);
      try {await navigator.clipboard.writeText(url);onNotice("Private trip link created and copied. Send it to your trusted contact yourself.");}
      catch {onNotice("Private trip link created. Copy it below and send it to your trusted contact yourself.");}
    } catch (e) {onError(displayError(e));}
    finally {setSaving(false);}
  }
  async function sos(rideId: string) {
    if (!window.confirm("Record an SOS incident for this trip? This creates a case for DRIVE review; it does not contact emergency services or send SMS to your contacts.")) return;
    setSaving(true);
    try {
      const result = await call<{incidentId: string; notified: boolean}>("reportSafetyIncident", {rideId, type: "sos", note: "SOS initiated from the Safety Centre"});
      onNotice(result.notified ? "SOS record created and alert sent." : "SOS record created for admin review. No emergency alert was sent. If you are in immediate danger in Bangladesh, call 999 directly.");
    } catch (e) {onError(displayError(e));}
    finally {setSaving(false);}
  }
  if (!user) return <SignedOut onNeedAuth={onNeedAuth}/>;
  return <div className="feature-layout">
    <section className="panel feature-intro safety-intro">
      <div className="feature-icon coral-icon">♡</div><div><p className="eyebrow">FR-14 · FR-15</p><h3>Safety Centre</h3><p className="muted">Manage trip sharing, trusted contacts, verified-driver preferences and incident reporting in one place.</p></div>
      <div className="safety-callout"><b>In immediate danger?</b><span>DRIVE is an academic prototype, not an emergency dispatch service.</span><a className="button outline compact" href="tel:999">Call Bangladesh 999</a></div>
    </section>
    <div className="feature-columns">
      <section className="panel">
        <div className="panel-title"><span className="panel-number">01</span><div><h3>Women Safety Mode</h3><p>These preferences are private to your account.</p></div></div>
        <form onSubmit={save}>
          <label className="toggle-row"><span><b>Enable Women Safety Mode</b><small>Show safety controls prominently and use your selected contact preferences.</small></span><input type="checkbox" checked={preferences.safetyMode} onChange={e => setPreferences(p => ({...p, safetyMode: e.target.checked}))}/></label>
          <Field label="Driver preference"><select value={preferences.driverPreference} onChange={e => setPreferences(p => ({...p, driverPreference: e.target.value as SafetyPreferences["driverPreference"]}))}><option value="any">Any eligible approved driver</option><option value="verified_only">Verified/approved driver only</option></select></Field>
          <label className="toggle-row"><span><b>Prefer trip sharing by default</b><small>This remembers your preference; it does not automatically message anyone.</small></span><input type="checkbox" checked={preferences.shareTripByDefault} onChange={e => setPreferences(p => ({...p, shareTripByDefault: e.target.checked}))}/></label>
          <div className="field"><label>Preferred trusted contacts</label><div className="contact-select-list">{contacts.length === 0 ? <p className="muted tiny">Add a trusted contact first.</p> : contacts.map(contact => <label key={contact.contactId} className="check-row"><input type="checkbox" checked={preferences.preferredContactIds.includes(contact.contactId)} onChange={e => setPreferences(p => ({...p, preferredContactIds: e.target.checked ? [...p.preferredContactIds, contact.contactId].slice(0,10) : p.preferredContactIds.filter(id => id !== contact.contactId)}))}/><span>{contact.name}<small>{contact.relationship} · {contact.phone}</small></span></label>)}</div></div>
          <button className="button primary" disabled={saving || loading}>{saving ? "Saving…" : "Save safety preferences"}</button>
          <p className="tiny muted">Verified-only preference is stored, but driver matching enforcement and female-driver availability are not guaranteed by the current dispatch service.</p>
        </form>
      </section>
      <section className="panel">
        <div className="panel-title"><span className="panel-number">02</span><div><h3>Trusted contacts</h3><p>Save someone you trust for manual trip sharing.</p></div></div>
        <form onSubmit={addContact}>
          <Field label="Contact name"><input required minLength={2} maxLength={80} value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Family member"/></Field>
          <Field label="Phone number"><input required value={phone} onChange={e => setPhone(e.target.value)} placeholder="+8801XXXXXXXXX" inputMode="tel"/></Field>
          <Field label="Relationship"><select value={relationship} onChange={e => setRelationship(e.target.value)}><option>Family</option><option>Friend</option><option>Partner</option><option>Colleague</option><option>Other</option></select></Field>
          <button className="button outline" disabled={saving}>{saving ? "Saving…" : "Add trusted contact"}</button>
        </form>
        <div className="contact-list">{contacts.map(contact => <div className="contact-item" key={contact.contactId}><span className="avatar">{contact.name.slice(0,1).toUpperCase()}</span><div><b>{contact.name}</b><small>{contact.relationship} · {contact.phone}</small></div><button className="icon-button" aria-label={"Delete "+contact.name} disabled={saving} onClick={() => void deleteContact(contact.contactId)}>×</button></div>)}{!contacts.length && <p className="muted tiny">No trusted contacts saved yet.</p>}</div>
      </section>
    </div>
    <section className="panel">
      <div className="panel-title"><span className="panel-number">03</span><div><h3>Share a live trip</h3><p>Create a time-limited private link for an active trip. Send it manually to your contact.</p></div></div>
      <div className="share-trip-controls">
        <Field label="Active trip"><select value={selectedRide} onChange={e => setSelectedRide(e.target.value)}><option value="">Choose an active trip</option>{activeRides.map(ride => <option key={ride.id} value={ride.id}>{ride.pickup?.label || "Pickup"} → {ride.destination?.label || "Destination"} · {ride.id.slice(0,8)}</option>)}</select></Field>
        <Field label="Link expiry"><select value={shareExpires} onChange={e => setShareExpires(e.target.value)}><option value="30">30 minutes</option><option value="60">1 hour</option><option value="120">2 hours</option></select></Field>
        <button className="button primary" disabled={saving || !activeRides.length} onClick={() => void shareTrip()}>Create private link</button>
      </div>
      {shareLink && <div className="share-link-row"><input readOnly value={shareLink} aria-label="Private trip share link"/><button className="button outline compact" onClick={() => void navigator.clipboard.writeText(shareLink)}>Copy link</button></div>}
      <p className="tiny muted">The link shows limited trip status and the latest available location. It expires automatically. No SMS/push notification is sent by this prototype.</p>
    </section>
    <section className="panel">
      <div className="panel-title"><span className="panel-number">04</span><div><h3>Emergency & safe-trip reports</h3><p>Choose an active trip to create an incident record with the latest available trip-location context.</p></div></div>
      {activeRides.length ? <div className="safety-ride-list">{activeRides.map(ride => <div className="safety-ride" key={ride.id}><div><b>{ride.pickup?.label || "Pickup"} → {ride.destination?.label || "Destination"}</b><small>{(ride.status || "active").replaceAll("_"," ")} · {ride.id.slice(0,10)}</small></div><button className="button danger compact" disabled={saving} onClick={() => void sos(ride.id)}>SOS report</button></div>)}</div> : <p className="muted">No active trip right now. SOS reports are available from an assigned active trip.</p>}
      <div className="alert warning">SOS creates a reviewable record and captures fresh driver-location context when available. External emergency dispatch, SMS delivery and automatic route-deviation detection are not configured.</div>
    </section>
  </div>;
}

export function TouristPage({user, onNeedAuth, onError, onNotice}: {
  user: User | null; onNeedAuth: () => void; onError: Notice; onNotice: Notice;
}) {
  const [center, setCenter] = useState({lat: 23.8103, lng: 90.4125});
  const [category, setCategory] = useState("tourist_attraction");
  const [radius, setRadius] = useState("5000");
  const [places, setPlaces] = useState<TouristPlace[]>([]);
  const [selected, setSelected] = useState<TouristPlace[]>([]);
  const [busy, setBusy] = useState(false);
  const [route, setRoute] = useState<{distanceMeters: number; durationSeconds: number; optimizedIntermediateWaypointIndex?: number[]; warning?: string} | null>(null);
  const [language, setLanguage] = useState<"en"|"bn">("en");
  const [areaLabel, setAreaLabel] = useState("Dhaka city centre");
  async function locate() {
    if (!navigator.geolocation) {onError("This browser does not support location permission.");return;}
    navigator.geolocation.getCurrentPosition(pos => {
      setCenter({lat: pos.coords.latitude, lng: pos.coords.longitude});
      setAreaLabel("Your current location");
      onNotice("Search area updated from the location permission you granted.");
    }, err => onError(err.code === 1 ? "Location permission was denied. You can still search around Dhaka city centre." : "Could not get your location. Try again or use the default Dhaka search area."), {enableHighAccuracy: true, timeout: 10000, maximumAge: 60000});
  }
  async function search() {
    if (!user) {onNeedAuth();return;}
    setBusy(true);setRoute(null);
    try {
      const result = await call<{places: TouristPlace[]}>("discoverTouristPlaces", {center, category, radiusMeters: Number(radius), languageCode: language});
      setPlaces(result.places || []);
      if (!result.places?.length) onNotice("No places were returned for this category and radius. Try a wider radius or another category.");
    } catch (e) {onError(displayError(e));}
    finally {setBusy(false);}
  }
  function toggle(place: TouristPlace) {
    setSelected(old => old.some(p => p.placeId === place.placeId) ? old.filter(p => p.placeId !== place.placeId) : old.length >= 7 ? old : [...old, place]);
  }
  async function planRoute() {
    if (!user) {onNeedAuth();return;}
    if (selected.length < 2) {onError("Add at least two places to your itinerary.");return;}
    setBusy(true);
    try {
      const result = await call<{distanceMeters: number; durationSeconds: number; optimizedIntermediateWaypointIndex?: number[]; warning?: string}>("getTouristRoute", {
        origin: {lat: selected[0]!.lat, lng: selected[0]!.lng},
        destination: {lat: selected[selected.length-1]!.lat, lng: selected[selected.length-1]!.lng},
        waypoints: selected.slice(1,-1).map(p => ({lat: p.lat, lng: p.lng})),
        travelMode: "DRIVE", optimizeStops: true
      });
      setRoute(result);
      onNotice("Route plan calculated using Google Routes.");
    } catch (e) {onError(displayError(e));}
    finally {setBusy(false);}
  }
  const mapsUrl = useMemo(() => {
    if (selected.length < 2) return "";
    const origin = encodeURIComponent(selected[0]!.lat + "," + selected[0]!.lng);
    const destination = encodeURIComponent(selected[selected.length-1]!.lat + "," + selected[selected.length-1]!.lng);
    const waypoints = selected.slice(1,-1).map(p => p.lat + "," + p.lng).join("|");
    return "https://www.google.com/maps/dir/?api=1&origin="+origin+"&destination="+destination+(waypoints ? "&waypoints="+encodeURIComponent(waypoints) : "")+"&travelmode=driving";
  }, [selected]);
  const categories = [
    ["tourist_attraction","Attractions"],["museum","Museums"],["park","Parks"],["restaurant","Restaurants"],
    ["lodging","Hotels & stays"],["hospital","Hospitals"],["pharmacy","Pharmacies"],["atm","ATMs"]
  ];
  return <div className="feature-layout">
    <section className="panel feature-intro tourist-intro"><div className="feature-icon">⌖</div><div><p className="eyebrow">FR-16 · TOURIST MODE</p><h3>Explore more. Plan smarter.</h3><p className="muted">Discover nearby attractions and useful facilities, build a multi-stop itinerary, and calculate a route before you travel.</p></div><button className="button outline compact" onClick={() => void locate()}>Use my location</button></section>
    <div className="tourist-layout">
      <section className="panel tourist-controls">
        <div className="panel-title"><span className="panel-number">01</span><div><h3>Discover nearby places</h3><p>Search area: {areaLabel}</p></div></div>
        <Field label="Place category"><select value={category} onChange={e => setCategory(e.target.value)}>{categories.map(([value,label]) => <option value={value} key={value}>{label}</option>)}</select></Field>
        <Field label="Search radius"><select value={radius} onChange={e => setRadius(e.target.value)}><option value="1000">1 km</option><option value="3000">3 km</option><option value="5000">5 km</option><option value="10000">10 km</option></select></Field>
        <Field label="Language"><select value={language} onChange={e => setLanguage(e.target.value as "en"|"bn")}><option value="en">English</option><option value="bn">বাংলা</option></select></Field>
        <button className="button primary full" disabled={busy} onClick={() => void search()}>{busy ? "Searching…" : "Find nearby places"}</button>
        <p className="tiny muted">Location access is optional. Without permission, search uses the Dhaka city-centre default shown above.</p>
      </section>
      <section className="tourist-results">
        <div className="section-mini-heading"><div><p className="eyebrow">RECOMMENDATIONS</p><h3>{places.length ? places.length+" places found" : "Places around you"}</h3></div><span className="section-tag">{selected.length}/7 stops</span></div>
        {places.length ? places.map(place => {
          const isSelected = selected.some(p => p.placeId === place.placeId);
          return <article className="panel tourist-place" key={place.placeId}><div className="place-illustration">{category === "restaurant" ? "⌁" : category === "hospital" || category === "pharmacy" ? "+" : category === "atm" ? "৳" : "✦"}</div><div className="place-content"><div className="place-heading"><h4>{place.name}</h4>{typeof place.rating === "number" && <span className="rating">★ {place.rating.toFixed(1)} <small>({place.reviewCount || 0})</small></span>}</div><p className="muted">{place.address || "Address not provided by Maps"}</p><small className="muted">{place.types.slice(0,3).join(" · ")}</small><button className={"button compact "+(isSelected ? "outline" : "primary")} disabled={!isSelected && selected.length >= 7} onClick={() => toggle(place)}>{isSelected ? "Remove stop" : "Add to itinerary"}</button></div></article>;
        }) : <div className="panel feature-empty"><div className="feature-icon">✦</div><h3>Find your next stop</h3><p className="muted">Choose a category and search to discover attractions, restaurants, parks, hotels and nearby facilities.</p></div>}
      </section>
    </div>
    <section className="panel itinerary-panel">
      <div className="panel-title"><span className="panel-number">02</span><div><h3>Your travel plan</h3><p>Choose at least two stops. The first is the origin and the last is the destination.</p></div></div>
      {selected.length ? <div className="itinerary-list">{selected.map((place,index) => <div className="itinerary-stop" key={place.placeId}><span className="stop-number">{index+1}</span><div><b>{place.name}</b><small>{place.address}</small></div><button className="icon-button" aria-label={"Remove "+place.name} onClick={() => toggle(place)}>×</button></div>)}</div> : <p className="muted">Your selected stops will appear here.</p>}
      <div className="itinerary-actions"><button className="button primary" disabled={busy || selected.length < 2} onClick={() => void planRoute()}>{busy ? "Planning…" : "Optimize route"}</button>{mapsUrl && <a className="button outline" href={mapsUrl} target="_blank" rel="noreferrer">Open in Google Maps ↗</a>}</div>
      {route && <div className="route-summary"><div><small>Route distance</small><b>{formatDistance(route.distanceMeters)}</b></div><div><small>Estimated travel time</small><b>{formatDuration(route.durationSeconds)}</b></div><p className="tiny muted">{route.warning}</p></div>}
    </section>
  </div>;
}

export function SharedRidePage({user, onNeedAuth, onError, onNotice, onBooked}: {
  user: User | null; onNeedAuth: () => void; onError: Notice; onNotice: Notice; onBooked: (rideId: string) => void;
}) {
  const [groups, setGroups] = useState<SharedGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState("");
  async function refresh() {
    if (!user) {onNeedAuth();return;}
    setLoading(true);
    try {const result = await call<{groups: SharedGroup[]}>("getMySharedRideRequests");setGroups(result.groups || []);}
    catch (e) {onError(displayError(e));}
    finally {setLoading(false);}
  }
  useEffect(() => {if (user) void refresh(); else setGroups([]);}, [user?.uid]);
  async function leave(groupId: string) {
    setBusyId(groupId);
    try {await call("leaveSharedRideGroup",{groupId});onNotice("You left the shared ride search.");await refresh();}
    catch(e){onError(displayError(e));}
    finally{setBusyId("");}
  }
  async function book(group: SharedGroup) {
    setBusyId(group.groupId);
    try {
      const result = await call<{rideId: string}>("bookSharedRideGroup",{groupId: group.groupId});
      onNotice("Shared ride created. Finding an approved nearby driver now.");
      try {await call("dispatchNearbyDrivers",{rideId:result.rideId});}
      catch(e){onNotice("Shared ride saved; driver matching needs a retry: "+displayError(e));}
      onBooked(result.rideId);
    } catch(e){onError(displayError(e));}
    finally{setBusyId("");}
  }
  if (!user) return <SignedOut onNeedAuth={onNeedAuth}/>;
  return <div className="feature-layout">
    <section className="panel feature-intro shared-intro"><div className="feature-icon">⇄</div><div><p className="eyebrow">FR-07 · FR-08</p><h3>Share the route. Split the cost.</h3><p className="muted">DRIVE looks for riders travelling in a similar direction and groups compatible requests before the organizer confirms the ride.</p></div><button className="button outline compact" disabled={loading} onClick={() => void refresh()}>Refresh matches</button></section>
    <div className="alert warning">Shared matching uses a nearby pickup/destination compatibility rule. The first version uses the organizer's route and an equal BDT fare split as a provisional estimate; the fare can change if the actual shared route differs. Payment per passenger is cash-only in this prototype.</div>
    {loading && <div className="panel"><p className="muted">Loading your shared requests…</p></div>}
    {!loading && !groups.length && <div className="panel feature-empty"><div className="feature-icon">⇄</div><h3>No shared requests yet</h3><p className="muted">On the Book a ride page, choose your locations, get a quote, then enable “Find compatible co-riders” before submitting.</p><button className="button primary" onClick={() => onNotice("Open Book a ride and enable shared ride matching.")}>How to start</button></div>}
    <div className="shared-group-grid">{groups.map(group => <article className="panel shared-group-card" key={group.groupId}><div className="group-top"><span className={"pill "+(group.status==="matched"?"matched":"")}>{group.status.replaceAll("_"," ")}</span><span className="muted tiny">{group.memberCount}/{group.maxPassengers} riders</span></div><h3>{group.memberCount >= 2 ? "Compatible riders found" : "Finding compatible riders"}</h3><div className="group-route"><span className="route-point green"/><div><b>{group.members[0]?.pickupLabel || "Pickup"}</b><small>to {group.members[0]?.destinationLabel || "Destination"}</small></div></div><div className="group-members">{group.members.map((member,i)=><span key={member.uid} className="member-chip">{member.isYou ? "You" : "Co-rider "+(i+1)}</span>)}</div><div className="group-fares"><div><small>Estimated group fare</small><b>{formatBdt(group.totalEstimatedFareMinor)}</b></div><div><small>Your estimated share</small><b>{group.shareForCurrentUser === null ? "—" : formatBdt(group.shareForCurrentUser)}</b></div></div><p className="tiny muted">{group.note}</p>{group.status==="matched" && group.leaderUid===user.uid && <button className="button primary full" disabled={busyId===group.groupId} onClick={() => void book(group)}>{busyId===group.groupId ? "Booking…" : "Confirm shared ride"}</button>}{group.status==="matched" && group.leaderUid!==user.uid && <p className="alert success">Waiting for the organizer to confirm the group ride.</p>}{["searching","matched"].includes(group.status) && <button className="button outline compact" disabled={busyId===group.groupId} onClick={() => void leave(group.groupId)}>Leave group</button>}{group.rideId && <p className="tiny muted">Ride ID: {group.rideId}</p>}</article>)}</div>
  </div>;
}

export function TripCard({ride, user, payment, onError, onNotice}: {
  ride: Ride; user: User; payment?: {method?: string; status?: string; amountMinor?: number; rideId?: string};
  onError: Notice; onNotice: Notice;
}) {
  const [expanded, setExpanded] = useState(false);
  const [location, setLocation] = useState<{lat:number;lng:number;updatedAt:number;heading?:number}|null>(null);
  const [trackingError, setTrackingError] = useState("");
  const [driver, setDriver] = useState<DriverSummary|null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [message, setMessage] = useState("");
  const [rating, setRating] = useState(5);
  const [review, setReview] = useState("");
  const [disputeTopic, setDisputeTopic] = useState("service");
  const [disputeText, setDisputeText] = useState("");
  const [shareLink, setShareLink] = useState("");
  const [busy, setBusy] = useState(false);
  const active = ["matching","accepted","driver_arriving","in_progress"].includes(ride.status || "");
  const isRider = ride.riderId === user.uid || (ride.riderIds || []).includes(user.uid);
  const isParticipant = isRider || ride.driverId === user.uid;
  const fareMinor = ride.sharedRide && ride.fareShares?.[user.uid] !== undefined
    ? ride.fareShares[user.uid] : (ride.finalFare?.totalMinor ?? ride.fare?.totalMinor ?? 0);
  const dateLabel = ride.createdAt?.toDate?.().toLocaleString() || "Recent trip";
  useEffect(() => {
    if (!expanded || !active || !rtdb || !isParticipant) {setLocation(null);return;}
    const locationRef = rtdbRef(rtdb, "tripLocations/" + ride.id);
    const unsubscribe = onValue(locationRef, snap => {
      const value = snap.val() as Record<string, unknown> | null;
      if (value && typeof value.lat === "number" && typeof value.lng === "number" && typeof value.updatedAt === "number") {
        setLocation({lat:value.lat,lng:value.lng,updatedAt:value.updatedAt, ...(typeof value.heading==="number"?{heading:value.heading}:{})});
        setTrackingError("");
      } else setLocation(null);
    }, error => setTrackingError(error.message || "Location access is unavailable."));
    return () => unsubscribe();
  }, [expanded, active, ride.id, isParticipant]);
  useEffect(() => {
    if (!expanded || !active || !db || !isParticipant) {setMessages([]);return;}
    return onSnapshot(query(collection(db,"rides",ride.id,"messages"),orderBy("createdAt","desc"),limit(30)),
      snap => setMessages(snap.docs.map(d=>({id:d.id,...d.data()} as Message)).reverse()),
      error => setTrackingError(displayError(error)));
  }, [expanded, active, ride.id, isParticipant]);
  useEffect(() => {
    if (!expanded || !ride.driverId || !isParticipant) {setDriver(null);return;}
    let alive=true;
    void call<DriverSummary>("getRideDriverSummary",{rideId:ride.id}).then(value=>{if(alive)setDriver(value);}).catch(()=>{if(alive)setDriver(null);});
    return ()=>{alive=false;};
  }, [expanded, ride.id, ride.driverId, isParticipant]);
  async function cancel() {
    const text = ride.sharedRide ? "Cancel this shared trip for every rider in the group?" : "Cancel this ride request?";
    if (!window.confirm(text)) return;
    setBusy(true);
    try {await call("cancelRide",{rideId:ride.id});onNotice("Ride cancellation requested.");}
    catch(e){onError(displayError(e));}
    finally{setBusy(false);}
  }
  async function sos(type: "sos"|"route_deviation"|"long_stop") {
    const note = type==="sos" ? "SOS report from the active trip card" : type==="route_deviation" ? "Passenger reported a possible route deviation" : "Passenger reported an unusual stop";
    if (type==="sos" && !window.confirm("Create an SOS incident record? No emergency dispatch or contact notification will be sent.")) return;
    setBusy(true);
    try {
      await call("reportSafetyIncident",{rideId:ride.id,type,note});
      onNotice(type==="sos" ? "SOS record created for admin review. If in immediate danger in Bangladesh, call 999." : "Safety concern recorded for admin review.");
    } catch(e){onError(displayError(e));}
    finally{setBusy(false);}
  }
  async function sendMessage(event: FormEvent) {
    event.preventDefault();
    if (!message.trim()) return;
    setBusy(true);
    try {await call("sendRideMessage",{rideId:ride.id,text:message.trim(),clientMessageId:crypto.randomUUID()});setMessage("");}
    catch(e){onError(displayError(e));}
    finally{setBusy(false);}
  }
  async function submitRating(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {await call("rateCompletedRide",{rideId:ride.id,stars:rating,comment:review.trim()});onNotice("Thanks—your review was recorded.");setReview("");}
    catch(e){onError(displayError(e));}
    finally{setBusy(false);}
  }
  async function openDispute(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const result = await call<{disputeId:string;status:string;warning:string}>("openServiceDispute",{serviceType:"ride",serviceId:ride.id,topic:disputeTopic,description:disputeText.trim()});
      onNotice("Support case opened: "+result.disputeId+". No automatic refund has been issued.");
      setDisputeText("");
    } catch(e){onError(displayError(e));}
    finally{setBusy(false);}
  }
  async function createShare() {
    setBusy(true);
    try {
      const result = await call<{sharePath:string;note:string}>("createTripShare",{rideId:ride.id,expiresInMinutes:60});
      const url=window.location.origin+result.sharePath;
      setShareLink(url);
      try {await navigator.clipboard.writeText(url);onNotice("Trip link copied. Share it manually with someone you trust.");}
      catch {onNotice("Trip link created. Copy the link below.");}
    } catch(e){onError(displayError(e));}
    finally{setBusy(false);}
  }
  async function paymentAction(method:"cash"|"stripe") {
    setBusy(true);
    try {
      if(method==="cash") {
        const result= ride.sharedRide
          ? await call<{status:string;amountMinor?:number}>("chooseCashForSharedRide",{rideId:ride.id})
          : await call<{status:string}>("chooseCashForRide",{rideId:ride.id});
        onNotice("Cash selected ("+result.status+"). This is not proof of collection.");
      } else {
        if(ride.sharedRide) {onError("Stripe TEST checkout does not yet support per-passenger shared-fare splits. Use the displayed cash option for this academic prototype.");return;}
        const result=await call<{checkoutUrl:string}>("prepareStripeTestCheckout",{rideId:ride.id});
        if(!result.checkoutUrl?.startsWith("https://checkout.stripe.com/")) throw new Error("Unexpected checkout URL.");
        window.location.assign(result.checkoutUrl);
      }
    } catch(e){onError(displayError(e));}
    finally{setBusy(false);}
  }
  const locationFresh = location && Date.now()-location.updatedAt < 60000;
  const mapsUrl = "https://www.google.com/maps/dir/?api=1&origin="+encodeURIComponent((ride.pickup?.lat||0)+","+(ride.pickup?.lng||0))+"&destination="+encodeURIComponent((ride.destination?.lat||0)+","+(ride.destination?.lng||0))+"&travelmode=driving";
  return <article className="trip-card">
    <div className="trip-card-main">
      <div className="trip-route"><span className="route-point green"></span><div><b>{ride.pickup?.label || "Pickup location"}</b><small>to {ride.destination?.label || "Destination"}</small></div></div>
      <div className="trip-meta"><span className="pill">{(ride.status || "unknown").replaceAll("_"," ")}</span><b>{formatBdt(fareMinor)}</b><small>{ride.vehicleType || "Ride"}{ride.sharedRide ? " · Shared" : ""} · {dateLabel}</small></div>
    </div>
    <div className="trip-card-actions"><button className="button outline compact" onClick={()=>setExpanded(v=>!v)}>{expanded?"Hide details":"Trip details & safety"}</button>{active && isRider && <button className="button danger compact" disabled={busy} onClick={()=>void sos("sos")}>SOS</button>}</div>
    {expanded && <div className="trip-detail-grid">
      <section className="trip-detail-section"><h4>Live trip tracking</h4><p className="muted tiny">Only trip participants can access the live location feed. A stale location is not shown as live.</p>
        {active ? <><div className="tracking-status"><span className={"status-light "+(locationFresh?"is-live":"")}></span><b>{locationFresh?"Live location updated":location?"Location is stale":"Waiting for driver location"}</b></div>{locationFresh && <div className="route-stats"><div><small>Latitude</small><b>{location!.lat.toFixed(5)}</b></div><div><small>Longitude</small><b>{location!.lng.toFixed(5)}</b></div><div><small>Updated</small><b>{new Date(location!.updatedAt).toLocaleTimeString()}</b></div><div><small>Heading</small><b>{location!.heading===undefined?"—":Math.round(location!.heading)+"°"}</b></div></div>}{trackingError && <p className="field-error">{trackingError}</p>}<a className="button outline compact" href={mapsUrl} target="_blank" rel="noreferrer">Open route in Maps ↗</a>{isRider && <div className="inline-actions"><button className="button outline compact" disabled={busy} onClick={()=>void createShare()}>Share trip link</button><button className="button outline compact" disabled={busy} onClick={()=>void sos("route_deviation")}>Report route deviation</button><button className="button outline compact" disabled={busy} onClick={()=>void sos("long_stop")}>Report unusual stop</button></div>}{shareLink && <div className="share-link-row"><input readOnly value={shareLink}/><button className="button outline compact" onClick={()=>void navigator.clipboard.writeText(shareLink)}>Copy</button></div>}</> : <p className="muted">Live tracking ends when the trip is completed or cancelled.</p>}
        {driver && <div className="driver-summary"><span className="avatar">✓</span><div><b>{driver.name} {driver.verified && <span className="pill">Approved driver</span>}</b><small>{driver.vehicleType}{driver.ratingAverage!==null?" · ★ "+driver.ratingAverage.toFixed(1):""}</small><p className="tiny muted">{driver.note}</p></div></div>}
      </section>
      <section className="trip-detail-section"><h4>Trip chat</h4>{active ? <><div className="chat-messages">{messages.map(m=><div className={"chat-bubble "+(m.senderId===user.uid?"mine":"")} key={m.id}><span>{m.text}</span><small>{m.createdAt?.toDate?.().toLocaleTimeString()||"Sending"}</small></div>)}{!messages.length && <p className="muted tiny">No messages yet. Keep messages relevant to the trip.</p>}</div><form className="chat-compose" onSubmit={sendMessage}><input value={message} onChange={e=>setMessage(e.target.value)} maxLength={1000} placeholder="Message your trip participant…"/><button className="button primary compact" disabled={busy||!message.trim()}>Send</button></form><p className="tiny muted">Messages are trip-scoped; they are not end-to-end encrypted.</p></> : <p className="muted">Chat is available during an assigned active trip.</p>}</section>
      {ride.status==="completed" && <section className="trip-detail-section"><h4>Rate this trip</h4><form onSubmit={submitRating}><Field label="Rating"><select value={rating} onChange={e=>setRating(Number(e.target.value))}>{[5,4,3,2,1].map(n=><option key={n} value={n}>{n} star{n===1?"":"s"}</option>)}</select></Field><Field label="Comment (optional)"><textarea maxLength={500} value={review} onChange={e=>setReview(e.target.value)} placeholder="Share helpful feedback"/></Field><button className="button outline compact" disabled={busy}>Submit review</button></form></section>}
      {(ride.status==="completed"||ride.status==="cancelled"||ride.status==="no_driver_found") && <section className="trip-detail-section"><h4>Contact support</h4><form onSubmit={openDispute}><Field label="Topic"><select value={disputeTopic} onChange={e=>setDisputeTopic(e.target.value)}><option value="service">Service</option><option value="payment">Payment</option><option value="safety">Safety</option><option value="other">Other</option></select></Field><Field label="Describe the issue"><textarea required minLength={25} maxLength={1200} value={disputeText} onChange={e=>setDisputeText(e.target.value)} placeholder="Include what happened and what resolution you are requesting."/></Field><button className="button outline compact" disabled={busy||disputeText.trim().length<25}>Open support case</button></form></section>}
      {ride.status==="completed" && <section className="trip-detail-section"><h4>Payment & receipt</h4><p className="muted tiny">Server status: {payment?.status||"No payment method recorded"}{payment?.method?" · "+payment.method:""}</p>{!payment || !["paid_test","cash_due","cash_reported_received"].includes(payment.status||"") ? <div className="inline-actions"><button className="button outline compact" disabled={busy} onClick={()=>void paymentAction("cash")}>Choose cash{ride.sharedRide?" · "+formatBdt(fareMinor):""}</button>{!ride.sharedRide && <button className="button primary compact" disabled={busy} onClick={()=>void paymentAction("stripe")}>Stripe TEST</button>}</div> : <p className="alert success">Payment state: {payment.status}. Cash due is not proof of collection.</p>}</section>}
      {ride.status==="matching" && isRider && <section className="trip-detail-section"><h4>Matching status</h4><p className="muted">DRIVE is searching for an eligible approved driver. If none accepts, you can retry matching after the backend cooldown.</p><button className="button outline compact" disabled={busy} onClick={async()=>{setBusy(true);try{await call("dispatchNearbyDrivers",{rideId:ride.id});onNotice("A driver matching attempt was requested.");}catch(e){onError(displayError(e));}finally{setBusy(false);}}}>Retry matching</button></section>}
      {active && isRider && <section className="trip-detail-section"><h4>Trip actions</h4><button className="button danger compact" disabled={busy} onClick={()=>void cancel()}>Cancel ride</button><p className="tiny muted">Cancellation follows the current server policy. For shared rides, cancellation affects the whole group.</p></section>}
    </div>}
  </article>;
}

export function AccountPage({user, onNeedAuth, onError, onNotice}: {
  user: User | null; onNeedAuth: () => void; onError: Notice; onNotice: Notice;
}) {
  const [displayName,setDisplayName]=useState("");
  const [locale,setLocale]=useState<"en"|"bn">("en");
  const [profileLoading,setProfileLoading]=useState(false);
  const [driverApplication,setDriverApplication]=useState<Record<string,unknown>|null>(null);
  const [driverProfile,setDriverProfile]=useState<Record<string,unknown>|null>(null);
  const [ownerProfile,setOwnerProfile]=useState<Record<string,unknown>|null>(null);
  const [vehicles,setVehicles]=useState<Vehicle[]>([]);
  const [ownerBookings,setOwnerBookings]=useState<RentalBooking[]>([]);
  const [driverRides,setDriverRides]=useState<Ride[]>([]);
  const [offers,setOffers]=useState<DriverOffer[]>([]);
  const [businessName,setBusinessName]=useState("");
  const [vehicleModel,setVehicleModel]=useState("");
  const [plate,setPlate]=useState("");
  const [vehicleType,setVehicleType]=useState("car");
  const [seats,setSeats]=useState("4");
  const [rate,setRate]=useState("1200");
  const [area,setArea]=useState("Dhaka");
  const [documents,setDocuments]=useState<File[]>([]);
  const [busy,setBusy]=useState(false);
  const [online,setOnline]=useState(false);
  const watchId=useRef<number|null>(null);
  useEffect(()=>{
    if(!user||!db){setVehicles([]);setOwnerBookings([]);setDriverRides([]);setOffers([]);return;}
    let alive=true;
    void Promise.all([
      getDoc(doc(db,"users",user.uid)),getDoc(doc(db,"driverApplications",user.uid)),
      getDoc(doc(db,"driverProfiles",user.uid)),getDoc(doc(db,"ownerProfiles",user.uid)),
      getDocs(query(collection(db,"vehicles"),where("ownerId","==",user.uid),limit(30))),
      getDocs(query(collection(db,"rentalBookings"),where("ownerId","==",user.uid),limit(30)))
    ]).then(([profile,driverApp,driver,owner,vehicleDocs,bookingDocs])=>{
      if(!alive)return;
      const p=profile.data()||{};
      setDisplayName(String(p.displayName||user.displayName||""));
      setLocale(p.locale==="bn"?"bn":"en");
      setDriverApplication(driverApp.exists()?driverApp.data():null);
      setDriverProfile(driver.exists()?driver.data():null);
      setOwnerProfile(owner.exists()?owner.data():null);
      setVehicles(vehicleDocs.docs.map(d=>({id:d.id,...d.data()} as Vehicle)));
      setOwnerBookings(bookingDocs.docs.map(d=>({id:d.id,...d.data()} as RentalBooking)));
      setOnline(driver.get("online")===true);
      setBusinessName(String(owner.get("businessName")||""));
    }).catch(e=>onError(displayError(e)));
    const stopRides=onSnapshot(query(collection(db,"rides"),where("driverId","==",user.uid),limit(30)),
      snap=>{if(alive)setDriverRides(snap.docs.map(d=>({id:d.id,...d.data()} as Ride)));},
      e=>onError(displayError(e)));
    const stopOffers=onSnapshot(query(collection(db,"driverOffers"),where("driverId","==",user.uid),limit(20)),
      snap=>{if(alive)setOffers(snap.docs.map(d=>({id:d.id,...d.data()} as DriverOffer)).filter(o=>o.status==="pending"));},
      ()=>{if(alive)setOffers([]);});
    return ()=>{alive=false;stopRides();stopOffers();};
  },[user?.uid]);
  useEffect(()=>()=>{if(watchId.current!==null)navigator.geolocation.clearWatch(watchId.current);},[]);
  if(!user)return <SignedOut onNeedAuth={onNeedAuth}/>;
  async function saveProfile(event:FormEvent){
    event.preventDefault();setBusy(true);
    try{
      if(!db||!auth?.currentUser)throw new Error("Firebase profile storage is unavailable.");
      const clean=displayName.trim();
      if(clean.length<2)throw new Error("Name must contain at least two characters.");
      await updateProfile(auth.currentUser,{displayName:clean});
      await updateDoc(doc(db,"users",user.uid),{displayName:clean,locale,updatedAt:serverTimestamp()});
      await call("ensureProfile",{displayName:clean,locale});
      onNotice("Profile saved.");
    }catch(e){onError(displayError(e));}
    finally{setBusy(false);}
  }
  async function applyDriver(event:FormEvent){
    event.preventDefault();
    if(!storage){onError("Firebase Storage is not configured.");return;}
    if(documents.length!==3){onError("Choose exactly three documents: licence, vehicle registration and identity/photo document.");return;}
    setBusy(true);
    try{
      const paths:string[]=[];
      for(const file of documents){
        const safe=file.name.replace(/[^A-Za-z0-9._-]/g,"_").slice(-90);
        const path="applications/"+user.uid+"/"+Date.now()+"_"+crypto.randomUUID()+"_"+safe;
        await uploadBytes(storageRef(storage,path),file,{contentType:file.type||"application/octet-stream"});
        paths.push(path);
      }
      const result=await call<{status:string}>("submitDriverApplication",{vehicleType,vehiclePlate:plate.trim(),vehicleModel:vehicleModel.trim(),documentPaths:paths});
      setDriverApplication({status:result.status});setDocuments([]);
      onNotice("Driver application submitted. Admin approval is required before going online.");
    }catch(e){onError(displayError(e));}
    finally{setBusy(false);}
  }
  async function applyOwner(event:FormEvent){
    event.preventDefault();setBusy(true);
    try{const result=await call<{status:string}>("submitOwnerApplication",{businessName:businessName.trim()});setOwnerProfile({businessName,approvalStatus:result.status});onNotice("Vehicle-owner application submitted for review.");}
    catch(e){onError(displayError(e));}finally{setBusy(false);}
  }
  async function registerVehicle(event:FormEvent){
    event.preventDefault();setBusy(true);
    try{
      const result=await call<{vehicleId:string;status:string}>("registerRentalVehicle",{
        model:vehicleModel.trim(),plate:plate.trim(),type:vehicleType,seatCount:Number(seats),
        rentalRatePerHourMinor:Math.round(Number(rate)*100),area:area.trim()
      });
      setVehicles(old=>[{id:result.vehicleId,model:vehicleModel,type:vehicleType,seatCount:Number(seats),rentalRatePerHourMinor:Math.round(Number(rate)*100),area,approvalStatus:result.status,rentalEnabled:false},...old]);
      onNotice("Vehicle submitted for admin approval. It will not appear in public rentals until approved.");
    }catch(e){onError(displayError(e));}finally{setBusy(false);}
  }
  async function cancelOwnerBooking(id:string){
    setBusy(true);
    try{await call("cancelRentalBooking",{bookingId:id});onNotice("Rental booking cancellation requested.");}
    catch(e){onError(displayError(e));}finally{setBusy(false);}
  }
  async function setAvailability(next:boolean){
    if(!next){
      if(watchId.current!==null){navigator.geolocation.clearWatch(watchId.current);watchId.current=null;}
      try{await call("setDriverAvailability",{online:false});if(rtdb)await remove(rtdbRef(rtdb,"driverLocations/"+user.uid));setOnline(false);onNotice("You are offline.");}
      catch(e){onError(displayError(e));}
      return;
    }
    if(!rtdb){onError("Realtime Database URL is missing from the Firebase web configuration.");return;}
    if(!navigator.geolocation){onError("This browser cannot publish live location.");return;}
    setBusy(true);
    try{
      await user.getIdToken(true);
      await call("setDriverAvailability",{online:true});
      setOnline(true);
      watchId.current=navigator.geolocation.watchPosition(async pos=>{
        const {latitude,longitude,accuracy,heading,speed}=pos.coords;
        const value={lat:latitude,lng:longitude,geohash:geohashForLocation([latitude,longitude]),
          heading:heading===null?0:Math.max(0,Math.min(360,heading)),accuracy:Math.max(0,Math.min(1000,accuracy)),
          updatedAt:Date.now(),...(speed!==null?{speed:Math.max(0,Math.min(120,speed*3.6))}:{})};
        try{await set(rtdbRef(rtdb,"driverLocations/"+user.uid),value);}
        catch(e){onError(displayError(e));}
      },async err=>{
        if(watchId.current!==null){navigator.geolocation.clearWatch(watchId.current);watchId.current=null;}
        try{await call("setDriverAvailability",{online:false});}catch{}
        setOnline(false);
        onError(err.code===1?"Location permission is required for driver online mode.":"Unable to read live location; you were set offline.");
      },{enableHighAccuracy:true,maximumAge:5000,timeout:15000});
      onNotice("Driver online. Keep this page open while available for requests.");
    }catch(e){setOnline(false);onError(displayError(e));}
    finally{setBusy(false);}
  }
  async function respond(offer:DriverOffer,accept:boolean){
    setBusy(true);
    try{const result=await call<{status:string}>("respondToOffer",{offerId:offer.id,accept});onNotice(result.status==="accepted"?"Ride offer accepted. Open your active ride below.":"Ride offer declined.");setOffers(old=>old.filter(o=>o.id!==offer.id));}
    catch(e){onError(displayError(e));}finally{setBusy(false);}
  }
  async function advance(ride:Ride){
    const next=ride.status==="accepted"?"driver_arriving":ride.status==="driver_arriving"?"in_progress":ride.status==="in_progress"?"completed":null;
    if(!next)return;
    if(next==="completed"&&!window.confirm("Complete this trip? The backend will record its final fare."))return;
    setBusy(true);
    try{await call("advanceRide",{rideId:ride.id,toStatus:next});onNotice("Trip updated: "+next.replaceAll("_"," "));}
    catch(e){onError(displayError(e));}finally{setBusy(false);}
  }
  const approvedDriver=driverProfile?.approvalStatus==="approved";
  const approvedOwner=ownerProfile?.approvalStatus==="approved";
  const activeDriverRides=driverRides.filter(r=>["accepted","driver_arriving","in_progress"].includes(r.status||""));
  const earnings=driverRides.filter(r=>r.status==="completed").reduce((sum,r)=>sum+(r.finalFare?.totalMinor||r.fare?.totalMinor||0),0);
  return <div className="feature-layout">
    <section className="panel feature-intro account-intro"><div className="feature-icon">◎</div><div><p className="eyebrow">FR-02 · FR-03 · FR-04 · FR-21 · FR-25</p><h3>Your account & service roles</h3><p className="muted">Manage your profile, apply to drive or list a vehicle, and review your service activity.</p></div><span className="pill">Signed in</span></section>
    <div className="feature-columns">
      <section className="panel"><div className="panel-title"><span className="panel-number">01</span><div><h3>Profile & accessibility</h3><p>Only allowed profile fields are updated in the shared Firebase account.</p></div></div>
        <form onSubmit={saveProfile}><Field label="Display name"><input required minLength={2} maxLength={80} value={displayName} onChange={e=>setDisplayName(e.target.value)}/></Field><Field label="Language"><select value={locale} onChange={e=>setLocale(e.target.value as "en"|"bn")}><option value="en">English</option><option value="bn">বাংলা</option></select></Field><Field label="Email"><input readOnly value={user.email||"Phone-authenticated account"} /></Field><Field label="Account ID"><input readOnly value={user.uid}/></Field><button className="button primary" disabled={busy}>{busy?"Saving…":"Save profile"}</button></form><p className="tiny muted">Account roles and admin privileges are assigned by the trusted backend, not by this form.</p>
      </section>
      <section className="panel"><div className="panel-title"><span className="panel-number">02</span><div><h3>Become a driver</h3><p>Three private application documents are required for review.</p></div></div>
        <div className="application-status"><span className="status-light"></span><b>Application: {String(driverApplication?.status||driverProfile?.approvalStatus||"not submitted").replaceAll("_"," ")}</b></div>
        {!approvedDriver && <form onSubmit={applyDriver}><Field label="Vehicle category"><select value={vehicleType} onChange={e=>setVehicleType(e.target.value)}><option value="bike">Bike</option><option value="car">Car</option><option value="premium">Premium</option></select></Field><Field label="Vehicle model"><input required minLength={2} maxLength={80} value={vehicleModel} onChange={e=>setVehicleModel(e.target.value)} placeholder="Model and year"/></Field><Field label="Registration / plate"><input required minLength={4} maxLength={32} value={plate} onChange={e=>setPlate(e.target.value)}/></Field><Field label="Upload 3 documents (PDF or image, under 10 MB each)"><input type="file" accept="image/*,application/pdf" multiple onChange={e=>setDocuments(Array.from(e.target.files||[]).slice(0,3))}/></Field><p className="tiny muted">{documents.length}/3 selected · files are stored in your private application folder.</p><button className="button outline" disabled={busy}>{busy?"Submitting…":"Submit driver application"}</button></form>}
        {approvedDriver && <div className="driver-online-control"><div><b>Driver availability</b><small>{online?"Online · location sharing active":"Offline"}</small></div><button className={"button "+(online?"danger":"primary")} disabled={busy} onClick={()=>void setAvailability(!online)}>{online?"Go offline":"Go online"}</button><p className="tiny muted">Going online publishes your current location to nearby-driver matching. Keep this browser tab open.</p></div>}
      </section>
    </div>
    {approvedDriver && <section className="panel"><div className="panel-title"><span className="panel-number">03</span><div><h3>Driver workbench</h3><p>Respond to offers and update your own assigned trip through server-controlled transitions.</p></div></div>
      <div className="earnings-strip"><div><small>Completed-trip gross estimate</small><b>{formatBdt(earnings)}</b></div><div><small>Completed rides in loaded sample</small><b>{driverRides.filter(r=>r.status==="completed").length}</b></div><div><small>Open offers</small><b>{offers.length}</b></div></div><p className="tiny muted">This is a bounded recent sample, not net earnings, settlement or a payout statement.</p>
      {offers.map(offer=><div className="driver-offer" key={offer.id}><div><b>{offer.pickup?.label||"Pickup"} → {offer.destination?.label||"Destination"}</b><small>{offer.vehicleType||"Ride"} · {formatBdt(offer.estimatedFareMinor||0)} · expires {offer.expiresAt?.toDate?.().toLocaleTimeString()||"soon"}</small></div><div className="inline-actions"><button className="button primary compact" disabled={busy} onClick={()=>void respond(offer,true)}>Accept</button><button className="button outline compact" disabled={busy} onClick={()=>void respond(offer,false)}>Decline</button></div></div>)}
      {activeDriverRides.map(ride=><div className="driver-offer" key={ride.id}><div><b>{ride.pickup?.label||"Pickup"} → {ride.destination?.label||"Destination"}</b><small>{(ride.status||"active").replaceAll("_"," ")} · {ride.id.slice(0,10)}</small></div><button className="button primary compact" disabled={busy} onClick={()=>void advance(ride)}>{ride.status==="accepted"?"Mark arriving":ride.status==="driver_arriving"?"Start trip":"Complete trip"}</button></div>)}
      {!offers.length&&!activeDriverRides.length&&<p className="muted">No open offers or active assigned trips.</p>}
    </section>}
    <section className="panel"><div className="panel-title"><span className="panel-number">04</span><div><h3>Become a vehicle owner</h3><p>Owner approval is separate from account creation.</p></div></div><div className="application-status"><span className="status-light"></span><b>Owner status: {String(ownerProfile?.approvalStatus||"not submitted").replaceAll("_"," ")}</b></div>
      {!approvedOwner && <form onSubmit={applyOwner} className="owner-application-form"><Field label="Business / owner display name"><input required minLength={2} maxLength={100} value={businessName} onChange={e=>setBusinessName(e.target.value)} placeholder="Your business name"/></Field><button className="button outline" disabled={busy}>{busy?"Submitting…":"Submit owner application"}</button></form>}
      {approvedOwner && <><div className="owner-vehicle-form"><h4>List a vehicle for rent</h4><form onSubmit={registerVehicle}><Field label="Model"><input required minLength={2} maxLength={100} value={vehicleModel} onChange={e=>setVehicleModel(e.target.value)}/></Field><Field label="Registration / plate (private)"><input required minLength={4} maxLength={32} value={plate} onChange={e=>setPlate(e.target.value)}/></Field><Field label="Vehicle type"><select value={vehicleType} onChange={e=>setVehicleType(e.target.value)}><option value="bike">Bike</option><option value="car">Car</option><option value="premium">Premium</option></select></Field><Field label="Seats"><select value={seats} onChange={e=>setSeats(e.target.value)}>{[1,2,4,5,7,8,12].map(n=><option key={n} value={n}>{n}</option>)}</select></Field><Field label="Hourly rate (BDT)"><input required type="number" min="1" max="50000" step="1" value={rate} onChange={e=>setRate(e.target.value)}/></Field><Field label="Area"><input required minLength={2} maxLength={100} value={area} onChange={e=>setArea(e.target.value)}/></Field><button className="button primary" disabled={busy}>{busy?"Submitting…":"Submit vehicle listing"}</button></form></div>
        <div className="owner-inventory"><h4>Your listings</h4>{vehicles.map(vehicle=><div className="history-row" key={vehicle.id}><div><b>{vehicle.model||vehicle.type||"Vehicle"}</b><small>{vehicle.area} · {vehicle.approvalStatus} · {vehicle.rentalEnabled?"Available to rent":"Not public yet"}</small></div><b>{formatBdt(vehicle.rentalRatePerHourMinor||0)}/hr</b></div>)}{!vehicles.length&&<p className="muted tiny">No listings yet.</p>}</div>
        <div className="owner-inventory"><h4>Rental bookings for your vehicles</h4>{ownerBookings.map(booking=><div className="history-row" key={booking.id}><div><b>{booking.vehicleId||"Rental booking"}</b><small>{booking.status} · {booking.startAt?.toDate?.().toLocaleString()||"Start pending"} – {booking.endAt?.toDate?.().toLocaleString()||"End pending"}</small></div>{["confirmed","requested","awaiting_owner"].includes(booking.status||"")&&<button className="button outline compact" disabled={busy} onClick={()=>void cancelOwnerBooking(booking.id)}>Cancel booking</button>}</div>)}{!ownerBookings.length&&<p className="muted tiny">No bookings for your vehicles yet.</p>}</div>
      </>}
    </section>
  </div>;
}

export function NotificationBell({user, onError, onOpenTrips}: {user:User|null;onError:Notice;onOpenTrips:()=>void}) {
  const [open,setOpen]=useState(false);
  const [items,setItems]=useState<{id:string;title?:string;body?:string;pushStatus?:string;createdAt?:{toDate?:()=>Date};type?:string}[]>([]);
  useEffect(()=>{
    if(!user||!db){setItems([]);return;}
    return onSnapshot(query(collection(db,"notifications"),where("uid","==",user.uid),limit(12)),
      snap=>setItems(snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(b.createdAt?.toDate?.().getTime()||0)-(a.createdAt?.toDate?.().getTime()||0))),
      e=>onError(displayError(e)));
  },[user?.uid]);
  return <div className="notification-wrap"><button className="icon-button notification-trigger" aria-label="Notifications" onClick={()=>setOpen(v=>!v)}>♧{items.length>0&&<span className="notification-count">{items.length}</span>}</button>{open&&<div className="notification-popover"><div className="notification-heading"><b>Notifications</b><button className="icon-button" onClick={()=>setOpen(false)}>×</button></div>{items.map(item=><button className="notification-item" key={item.id} onClick={()=>{setOpen(false);onOpenTrips();}}><b>{item.title||"DRIVE update"}</b><span>{item.body||"Open DRIVE for details."}</span><small>{item.pushStatus||"in-app record"} · {item.createdAt?.toDate?.().toLocaleString()||"Just now"}</small></button>)}{!items.length&&<p className="muted tiny">No notifications yet.</p>}</div>}</div>;
}

export function SharedTripPublicPage({token}: {token:string}) {
  const [trip,setTrip]=useState<{status:string;pickup:string;destination:string;vehicleType:string;location:{lat:number;lng:number;updatedAt:number;heading?:number}|null;expiresAtMs:number;lastUpdatedAtMs:number|null;warning:string}|null>(null);
  const [error,setError]=useState("");
  const [loading,setLoading]=useState(false);
  async function refresh(){
    setLoading(true);setError("");
    try{setTrip(await call("getSharedTrip",{token}));}
    catch(e){setTrip(null);setError(displayError(e));}
    finally{setLoading(false);}
  }
  useEffect(()=>{void refresh();const id=window.setInterval(()=>void refresh(),30000);return()=>window.clearInterval(id);},[token]);
  const fresh=trip?.location&&Date.now()-trip.location.updatedAt<120000;
  return <main className="shared-public-page"><div className="public-share-brand"><span className="brand-mark">↝</span><span>DRIVE</span></div><section className="panel public-share-card"><p className="eyebrow">PRIVATE TRIP SHARE</p><h1>Trip status</h1>{loading&&!trip&&<p className="muted">Loading shared trip…</p>}{error&&<div className="alert error">{error}</div>}{trip&&<><div className="public-route"><span className="route-point green"/><div><small>Pickup</small><b>{trip.pickup}</b></div></div><div className="public-route"><span className="route-point coral"/><div><small>Destination</small><b>{trip.destination}</b></div></div><div className="route-stats"><div><small>Status</small><b>{trip.status.replaceAll("_"," ")}</b></div><div><small>Vehicle</small><b>{trip.vehicleType}</b></div></div><div className="tracking-status"><span className={"status-light "+(fresh?"is-live":"")}></span><b>{fresh?"Recent location available":"No recent live location"}</b></div>{fresh&&<div className="route-stats"><div><small>Latitude</small><b>{trip.location!.lat.toFixed(5)}</b></div><div><small>Longitude</small><b>{trip.location!.lng.toFixed(5)}</b></div><div><small>Last update</small><b>{new Date(trip.location!.updatedAt).toLocaleTimeString()}</b></div></div>}<p className="tiny muted">{trip.warning}</p><p className="tiny muted">Link expires {new Date(trip.expiresAtMs).toLocaleString()}.</p><button className="button outline full" disabled={loading} onClick={()=>void refresh()}>Refresh status</button></>}</section><p className="tiny muted public-share-disclaimer">Only open a trip link from someone you trust. This link can reveal limited trip details to anyone who has it. It is not an emergency monitoring service.</p></main>;
}
