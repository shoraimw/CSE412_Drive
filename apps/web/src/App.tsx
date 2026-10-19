import {useCallback, useEffect, useRef, useState, type FormEvent} from "react";
import {
  GoogleAuthProvider, RecaptchaVerifier, createUserWithEmailAndPassword, sendPasswordResetEmail,
  onAuthStateChanged, sendEmailVerification, signInWithEmailAndPassword,
  signInWithPhoneNumber, signInWithPopup, signOut, updateProfile,
  type ConfirmationResult, type User
} from "firebase/auth";
import {
  collection, limit, onSnapshot, orderBy, query, where, getDocs
} from "firebase/firestore";
import {httpsCallable} from "firebase/functions";
import {AccountPage, NotificationBell, SafetyPage, SharedRidePage, SharedTripPublicPage, TouristPage, TripCard} from "./FeaturePages";
import {auth, db, firebaseReady, functions} from "./firebase";
import {
  displayError, formatBdt, formatDistance, formatDuration, validBangladeshPhone,
  type FareQuote, type PlaceSuggestion, type RidePoint
} from "./domain";

type Vehicle = {id: string; model?: string; type?: string; area?: string; seatCount?: number; rentalRatePerHourMinor?: number};
type Ride = {id: string; status?: string; vehicleType?: string; fare?: {totalMinor?: number}; currency?: string; createdAt?: {toDate?: () => Date}; pickup?: RidePoint; destination?: RidePoint; driverId?: string | null};
type RentalBooking = {id: string; vehicleId?: string; status?: string; startAt?: {toDate?: () => Date}; endAt?: {toDate?: () => Date}; totalMinor?: number; currency?: string};

async function call<T>(name: string, data: Record<string, unknown>): Promise<T> {
  if (!functions) throw new Error("Firebase is not configured. Add the web environment values first.");
  const response = await httpsCallable<Record<string, unknown>, T>(functions, name)(data);
  return response.data;
}

function PlaceField({label, signedIn, onNeedAuth, onResolved}: {label: string; signedIn: boolean; onNeedAuth: () => void; onResolved: (point: RidePoint) => void}) {
  const [value, setValue] = useState("");
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const session = useRef("");

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  function change(next: string) {
    setValue(next);
    setError("");
    if (timer.current) clearTimeout(timer.current);
    if (next.trim().length < 3) {
      setSuggestions([]);
      return;
    }
    if (!firebaseReady || !functions) {
      setSuggestions([]);
      setError("Location search is not configured on this deployment. Firebase web configuration is missing.");
      return;
    }
    if (!signedIn) {
      setSuggestions([]);
      setError("Sign in before searching for pickup and destination.");
      onNeedAuth();
      return;
    }
    if (!session.current) session.current = crypto.randomUUID();
    const token = session.current;
    timer.current = setTimeout(async () => {
      setLoading(true);
      try {
        const result = await call<{predictions: PlaceSuggestion[]}>("autocompletePlaces", {
          query: next.trim(), sessionToken: token
        });
        setSuggestions(result.predictions || []);
      } catch (e) {
        setError(displayError(e));
        setSuggestions([]);
      } finally {
        setLoading(false);
      }
    }, 350);
  }

  async function choose(item: PlaceSuggestion) {
    setLoading(true);
    setError("");
    try {
      const point = await call<RidePoint>("resolvePlace", {
        placeId: item.placeId,
        sessionToken: session.current || crypto.randomUUID()
      });
      setValue(point.label);
      setSuggestions([]);
      session.current = "";
      onResolved(point);
    } catch (e) {
      setError(displayError(e));
    } finally {
      setLoading(false);
    }
  }

  return <div className="field place-field">
    <label>{label}</label>
    <input value={value} onChange={event => change(event.target.value)}
      placeholder="Search a place in Bangladesh" autoComplete="off" />
    {loading && <span className="field-hint">Searching…</span>}
    {error && <span className="field-error">{error}</span>}
    {suggestions.length > 0 && <div className="suggestions" role="listbox">
      {suggestions.map(item => <button type="button" role="option" key={item.placeId}
        onClick={() => void choose(item)}>{item.description}</button>)}
    </div>}
  </div>;
}

function AuthPanel({onClose}: {onClose: () => void}) {
  const [mode, setMode] = useState<"signin" | "signup" | "phone">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [confirmation, setConfirmation] = useState<ConfirmationResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const verifier = useRef<RecaptchaVerifier | null>(null);

  useEffect(() => () => { verifier.current?.clear(); }, []);

  async function ensureProfile(user: User) {
    if (!functions) throw new Error("Firebase is not configured.");
    const displayName = user.displayName || (user.email ? user.email.split("@")[0] : "DRIVE Rider");
    await call("ensureProfile", {displayName: displayName.length >= 2 ? displayName : "DRIVE Rider", locale: "en"});
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!auth) { setError("Firebase setup is required before sign-in can work."); return; }
    setBusy(true); setError("");
    try {
      if (mode === "signup") {
        if (password.length < 8) throw new Error("Use a password with at least 8 characters.");
        const credential = await createUserWithEmailAndPassword(auth, email.trim(), password);
        if (name.trim()) await updateProfile(credential.user, {displayName: name.trim()});
        await sendEmailVerification(credential.user);
        await ensureProfile(credential.user);
      } else if (mode === "signin") {
        const credential = await signInWithEmailAndPassword(auth, email.trim(), password);
        await ensureProfile(credential.user);
      } else if (!confirmation) {
        if (!validBangladeshPhone(phone)) throw new Error("Enter a valid Bangladesh mobile number, e.g. +8801712345678.");
        verifier.current?.clear();
        verifier.current = new RecaptchaVerifier(auth, "drive-recaptcha", {size: "invisible"});
        const formatted = phone.startsWith("01") ? "+88" + phone : phone;
        const result = await signInWithPhoneNumber(auth, formatted, verifier.current);
        setConfirmation(result);
      } else {
        await confirmation.confirm(code.trim());
        setConfirmation(null);
      }
    } catch (e) {
      setError(displayError(e));
      verifier.current?.clear();
      verifier.current = null;
    } finally {
      setBusy(false);
    }
  }

  async function resetPassword() {
    if (!auth) { setError("Firebase setup is required before sign-in can work."); return; }
    if (!email.trim()) { setError("Enter your email address first."); return; }
    setBusy(true); setError("");
    try {
      await sendPasswordResetEmail(auth, email.trim());
      setError("If an account exists for that email, a password reset link has been sent.");
    } catch (e) { setError(displayError(e)); }
    finally { setBusy(false); }
  }

  async function google() {
    if (!auth) { setError("Firebase setup is required before sign-in can work."); return; }
    setBusy(true); setError("");
    try {
      const credential = await signInWithPopup(auth, new GoogleAuthProvider());
      await ensureProfile(credential.user);
    } catch (e) { setError(displayError(e)); }
    finally { setBusy(false); }
  }

  return <div className="modal-backdrop" role="presentation" onMouseDown={event => {
    if (event.target === event.currentTarget) onClose();
  }}>
    <section className="auth-card" role="dialog" aria-modal="true" aria-labelledby="auth-title">
      <button className="modal-close" onClick={onClose} aria-label="Close sign in">×</button>
      <div className="brand-mark small-mark">↝</div>
      <p className="eyebrow">WELCOME TO DRIVE</p>
      <h2 id="auth-title">{mode === "signup" ? "Create your account" : mode === "phone" ? "Continue with phone" : "Sign in to continue"}</h2>
      <p className="muted">Your city. Your journey.</p>
      <div className="auth-tabs">
        <button className={mode === "signin" ? "selected" : ""} onClick={() => {setMode("signin");setError("");setConfirmation(null);}}>Sign in</button>
        <button className={mode === "signup" ? "selected" : ""} onClick={() => {setMode("signup");setError("");setConfirmation(null);}}>Create account</button>
        <button className={mode === "phone" ? "selected" : ""} onClick={() => {setMode("phone");setError("");setConfirmation(null);}}>Phone OTP</button>
      </div>
      <form onSubmit={submit}>
        {mode === "signup" && <div className="field"><label>Full name</label><input required minLength={2} maxLength={80} value={name} onChange={e => setName(e.target.value)} autoComplete="name" /></div>}
        {mode !== "phone" ? <>
          <div className="field"><label>Email address</label><input required type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" /></div>
          <div className="field"><label>Password</label><input required type="password" minLength={8} value={password} onChange={e => setPassword(e.target.value)} autoComplete={mode === "signup" ? "new-password" : "current-password"} /></div>
        </> : <>
          {!confirmation ? <div className="field"><label>Bangladesh phone number</label><input required value={phone} onChange={e => setPhone(e.target.value)} placeholder="+8801712345678" inputMode="tel" autoComplete="tel" /> </div>
          : <div className="field"><label>Verification code</label><input required value={code} onChange={e => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" maxLength={6} /></div>}
          <div id="drive-recaptcha"></div>
        </>}
        {error && <div className="alert error" role="alert">{error}</div>}
        <button className="button primary full" type="submit" disabled={busy}>{busy ? "Please wait…" : mode === "signup" ? "Create account" : mode === "phone" ? confirmation ? "Verify code" : "Send OTP" : "Sign in"}</button>
      </form>
      {mode === "signin" && <button type="button" className="text-button" disabled={busy} onClick={() => void resetPassword()}>Forgot password?</button>}
      {mode !== "phone" && <button className="button outline full google-button" disabled={busy} onClick={() => void google()}>Continue with Google</button>}
      <p className="tiny muted">Phone OTP requires Firebase Phone Authentication, authorized domains, SMS quota and App Check configuration. Google login requires the web domain to be authorized in Firebase.</p>
    </section>
  </div>;
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [tab, setTab] = useState<"ride" | "rentals" | "trips" | "shared" | "safety" | "explore" | "account">("ride");
  const [language, setLanguage] = useState<"en" | "bn">("en");
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [shareRide, setShareRide] = useState(false);
  const [displayCurrency, setDisplayCurrency] = useState("BDT");
  const [fxRate, setFxRate] = useState(1);
  const [fxDate, setFxDate] = useState("");
  const [fxSource, setFxSource] = useState("BDT");
  const [fxError, setFxError] = useState("");
  const [mlInsight, setMlInsight] = useState<{modelStatus?: string; baseline?: {etaMinutes?: number; authoritativeFareMinor?: number; currency?: string}; insights?: Record<string, unknown>; note?: string; warning?: string; featureQuality?: string} | null>(null);
  const [rentalType, setRentalType] = useState("all");
  const [rentalArea, setRentalArea] = useState("");
  const [rentalMaxPrice, setRentalMaxPrice] = useState("");
  const [pickup, setPickup] = useState<RidePoint | null>(null);
  const [destination, setDestination] = useState<RidePoint | null>(null);
  const [vehicleType, setVehicleType] = useState<"bike" | "car" | "premium">("car");
  const [quote, setQuote] = useState<FareQuote | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [rides, setRides] = useState<Ride[]>([]);
  const [payments, setPayments] = useState<Record<string, {method?: string; status?: string}>>({});
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [bookings, setBookings] = useState<RentalBooking[]>([]);
  const [rentalStart, setRentalStart] = useState("");
  const [rentalEnd, setRentalEnd] = useState("");

  useEffect(() => {
    if (!auth) return;
    return onAuthStateChanged(auth, next => {
      setUser(next);
      setAuthOpen(false);
      setError("");
      if (next && functions) {
        const displayName = next.displayName || (next.email ? next.email.split("@")[0] : "DRIVE Rider");
        void call("ensureProfile", {displayName: displayName.length >= 2 ? displayName : "DRIVE Rider", locale: "en"})
          .catch(e => setError(displayError(e)));
      }
    });
  }, []);

  useEffect(() => {
    if (!db || !user) { setRides([]); setPayments({}); return; }
    let own: Ride[] = [];
    let shared: Ride[] = [];
    const publish = () => {
      const merged = new Map<string, Ride>();
      [...own, ...shared].forEach(ride => merged.set(ride.id, ride));
      setRides([...merged.values()].sort((a,b) =>
        (b.createdAt?.toDate?.().getTime() || 0) - (a.createdAt?.toDate?.().getTime() || 0)).slice(0,20));
    };
    const stopOwn = onSnapshot(query(collection(db, "rides"),
      where("riderId", "==", user.uid), orderBy("createdAt", "desc"), limit(10)),
      snap => {own = snap.docs.map(d => ({...d.data(), id: d.id} as Ride));publish();},
      e => setError(displayError(e)));
    const stopShared = onSnapshot(query(collection(db, "rides"),
      where("riderIds", "array-contains", user.uid), limit(20)),
      snap => {shared = snap.docs.map(d => ({...d.data(), id: d.id} as Ride));publish();},
      e => setError(displayError(e)));
    const stopPayments = onSnapshot(query(collection(db, "payments"),
      where("payerId", "==", user.uid), limit(20)),
      snap => setPayments(Object.fromEntries(snap.docs.map(d => {
        const value = d.data() as {method?: string; status?: string; rideId?: string; amountMinor?: number};
        return [value.rideId || d.id, value];
      }))),
      e => setError(displayError(e)));
    return () => {stopOwn();stopShared();stopPayments();};
  }, [user]);

  useEffect(() => {
    if (!db || tab !== "rentals") return;
    let alive = true;
    void getDocs(query(collection(db, "vehicles"),
      where("approvalStatus", "==", "approved"), where("rentalEnabled", "==", true),
      orderBy("rentalRatePerHourMinor", "asc"), limit(50)))
      .then(snap => {if (alive) setVehicles(snap.docs.map(doc => ({...doc.data(), id: doc.id} as Vehicle)));})
      .catch(e => {if (alive) setError(displayError(e));});
    return () => {alive = false;};
  }, [tab]);

  useEffect(() => {
    if (!db || !user) {setBookings([]);return;}
    return onSnapshot(query(collection(db, "rentalBookings"),
      where("renterId", "==", user.uid), orderBy("createdAt", "desc"), limit(20)),
      snap => setBookings(snap.docs.map(doc => ({...doc.data(), id: doc.id} as RentalBooking))),
      e => setError(displayError(e)));
  }, [user]);

  useEffect(() => {
    if (!quote || displayCurrency === "BDT") {setFxRate(1);setFxDate("");setFxSource("BDT");setFxError("");return;}
    let alive = true;
    setFxError("");
    void call<{rate:number;date:string;source:string}>("getCurrencyRate",{currency:displayCurrency})
      .then(result => {if(alive){setFxRate(result.rate);setFxDate(result.date);setFxSource(result.source);}})
      .catch(e => {if(alive){setFxRate(1);setFxError(displayError(e));}});
    return () => {alive = false;};
  }, [displayCurrency, quote?.quoteId]);

  const requireUser = useCallback(() => {
    if (!user) {setAuthOpen(true);return false;}
    return true;
  }, [user]);

  async function getQuote() {
    setError("");setNotice("");
    if (!requireUser()) return;
    if (!pickup || !destination) {setError("Choose both pickup and destination from the suggestions.");return;}
    setBusy(true);setMlInsight(null);setFxError("");
    try {
      const result = await call<FareQuote>("getFareQuote", {
        pickup: {lat: pickup.lat, lng: pickup.lng},
        destination: {lat: destination.lat, lng: destination.lng},
        pickupLabel: pickup.label, destinationLabel: destination.label, vehicleType
      });
      setQuote(result);
      void call<typeof mlInsight>("getMlTripInsights", {quoteId: result.quoteId})
        .then(value => setMlInsight(value))
        .catch(e => setMlInsight({modelStatus:"unavailable",note:displayError(e)}));
    } catch (e) {setError(displayError(e));setQuote(null);}
    finally {setBusy(false);}
  }

  async function requestRide() {
    if (!requireUser() || !quote) return;
    setBusy(true);setError("");setNotice("");
    try {
      if (shareRide) {
        const group = await call<{groupId:string;status:string;memberCount:number;shareForCurrentUser:number|null}>(
          "requestSharedRide", {quoteId: quote.quoteId, idempotencyKey: crypto.randomUUID()}
        );
        setNotice(group.status === "matched"
          ? "Compatible co-riders found. Open Shared rides to review the fare split; only the organizer can confirm."
          : "Shared ride request saved. DRIVE will wait for compatible co-riders.");
        setQuote(null);setTab("shared");
      } else {
        const ride = await call<{rideId: string}>("requestRide", {quoteId: quote.quoteId, idempotencyKey: crypto.randomUUID()});
        setNotice("Ride request created: " + ride.rideId + ". Matching is starting.");
        setQuote(null);setTab("trips");
        try {await call("dispatchNearbyDrivers", {rideId: ride.rideId});}
        catch (e) {setNotice("Ride request saved. Matching may need a retry: " + displayError(e));}
      }
    } catch (e) {setError(displayError(e));}
    finally {setBusy(false);}
  }

  async function reportSafety(rideId: string) {
    if (!requireUser()) return;
    const confirmed = window.confirm(
      "Record an SOS safety incident for this ride? This creates a report for the DRIVE admin team but does NOT contact emergency services or share your location with responders."
    );
    if (!confirmed) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await call<{incidentId: string; recorded: boolean; notified: boolean; warning?: string}>(
        "reportSafetyIncident", {rideId, type: "sos", note: "Rider requested SOS from DRIVE web"}
      );
      setNotice(result.notified
        ? "Safety incident recorded and alert sent."
        : "Safety incident recorded for admin review. No emergency alert was sent. If you are in immediate danger in Bangladesh, call 999 directly.");
    } catch (e) { setError(displayError(e)); }
    finally { setBusy(false); }
  }

  async function payCash(rideId: string) {
    setBusy(true);setError("");setNotice("");
    try {
      const result = await call<{status: string}>("chooseCashForRide", {rideId});
      setNotice("Cash selected. Status: " + result.status + ". This is not proof of cash collection.");
    } catch (e) {setError(displayError(e));}
    finally {setBusy(false);}
  }

  async function payStripeTest(rideId: string) {
    setBusy(true);setError("");setNotice("");
    try {
      const result = await call<{checkoutUrl: string}>("prepareStripeTestCheckout", {rideId});
      if (!result.checkoutUrl || !result.checkoutUrl.startsWith("https://checkout.stripe.com/")) {
        throw new Error("Payment provider returned an unexpected checkout URL.");
      }
      window.location.assign(result.checkoutUrl);
    } catch (e) {setError(displayError(e));setBusy(false);}
  }

  async function bookRental(vehicleId: string) {
    if (!requireUser()) return;
    const startAt = new Date(rentalStart).getTime();
    const endAt = new Date(rentalEnd).getTime();
    if (!Number.isFinite(startAt) || !Number.isFinite(endAt) || endAt <= startAt ||
        startAt < Date.now() + 60000 || startAt > Date.now() + 90 * 86400000 ||
        endAt - startAt > 72 * 3600000) {
      setError("Choose a future start (within 90 days) and a valid rental duration of at most 72 hours.");
      return;
    }
    setBusy(true);setError("");setNotice("");
    try {
      const result = await call<{bookingId: string}>("createRentalBooking", {
        vehicleId, startAtMs: startAt, endAtMs: endAt
      });
      setNotice("Rental booking created: " + result.bookingId);
    } catch (e) {setError(displayError(e));}
    finally {setBusy(false);}
  }

  async function cancelRental(bookingId: string) {
    setBusy(true);setError("");setNotice("");
    try {
      await call("cancelRentalBooking", {bookingId});
      setNotice("Rental booking cancelled.");
    } catch (e) {setError(displayError(e));}
    finally {setBusy(false);}
  }

  const shareToken = typeof window !== "undefined" && window.location.pathname.startsWith("/share/")
    ? window.location.pathname.split("/")[2] || "" : "";
  if (shareToken) return <SharedTripPublicPage token={shareToken}/>;
  const nav = language === "bn"
    ? [{id:"ride",label:"রাইড বুক"},{id:"shared",label:"শেয়ার রাইড"},{id:"rentals",label:"ভাড়া"},{id:"explore",label:"ঘুরে দেখুন"},{id:"safety",label:"নিরাপত্তা"},{id:"trips",label:"আমার ট্রিপ"},{id:"account",label:"অ্যাকাউন্ট"}] as const
    : [{id:"ride",label:"Book a ride"},{id:"shared",label:"Shared rides"},{id:"rentals",label:"Rentals"},{id:"explore",label:"Explore"},{id:"safety",label:"Safety"},{id:"trips",label:"My trips"},{id:"account",label:"Account"}] as const;
  const pageTitle: Record<typeof tab,string> = {
    ride: language==="bn"?"আপনার পরবর্তী রাইড":"Plan your next ride",
    shared: language==="bn"?"শেয়ার রাইড":"Shared ride matching",
    rentals: language==="bn"?"গাড়ি ভাড়া নিন":"Find a vehicle to rent",
    explore: language==="bn"?"ঘুরে দেখুন":"Tourist mode & route planning",
    safety: language==="bn"?"নিরাপত্তা কেন্দ্র":"Safety centre",
    trips: language==="bn"?"আপনার ট্রিপ":"Your activity",
    account: language==="bn"?"আপনার অ্যাকাউন্ট":"Your account & service roles"
  };
  const formatDisplayFare = (minor: number) => {
    const amount = minor / 100 * (displayCurrency === "BDT" ? 1 : fxRate);
    try {return new Intl.NumberFormat(language==="bn"?"bn-BD":"en-BD",{style:"currency",currency:displayCurrency,maximumFractionDigits:displayCurrency==="JPY"?0:2}).format(amount);}
    catch {return displayCurrency+" "+amount.toFixed(2);}
  };
  const filteredVehicles = vehicles.filter(vehicle =>
    (rentalType==="all" || vehicle.type===rentalType) &&
    (!rentalArea.trim() || (vehicle.area||"").toLowerCase().includes(rentalArea.trim().toLowerCase())) &&
    (!rentalMaxPrice || (vehicle.rentalRatePerHourMinor||0) <= Number(rentalMaxPrice)*100)
  );
  return <div className="app-shell" data-theme={theme}>
    <header className="topbar">
      <a href="#home" className="brand" aria-label="DRIVE home"><span className="brand-mark">↝</span><span>DRIVE</span></a>
      <nav aria-label="Main navigation">
        {nav.map(item => <button key={item.id} className={tab === item.id ? "nav-active" : ""} onClick={() => setTab(item.id)}>{item.label}</button>)}
      </nav>
      <div className="top-actions">
        <button className="button outline compact" onClick={()=>setLanguage(v=>v==="en"?"bn":"en")} aria-label="Switch language">{language==="en"?"বাংলা":"English"}</button>
        <button className="icon-button" onClick={()=>setTheme(v=>v==="dark"?"light":"dark")} aria-label="Toggle color theme">{theme==="dark"?"☼":"☾"}</button>
        {user && <NotificationBell user={user} onError={setError} onOpenTrips={()=>setTab("trips")}/>}
        {user ? <><span className="user-label">{user.displayName || user.email || user.phoneNumber}</span><button className="button outline compact" onClick={() => auth && void signOut(auth)}>Sign out</button></>
          : <button className="button primary compact" onClick={() => setAuthOpen(true)}>Sign in</button>}
      </div>
    </header>

    <main id="home">
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow"><span className="status-dot"></span> RIDE · RENT · EXPLORE</p>
          <h1>Your city.<br/><span>Your journey.</span></h1>
          <p className="hero-description">Rides, vehicle rentals and safer travel in one place.</p>
          <div className="hero-actions">
            <button className="button primary" onClick={() => {setTab("ride");if(!user)setAuthOpen(true);}}>Book a ride <span aria-hidden="true">↗</span></button>
            <button className="button outline" onClick={() => setTab("rentals")}>Explore rentals</button>
          </div>
          <div className="trust-row"><span>✓ Transparent fare quotes</span><span>✓ Verified driver workflow</span><span>✓ BDT pricing</span></div>
        </div>
        <div className="hero-visual" aria-label="DRIVE trip preview">
          <div className="map-glow"></div>
          <div className="map-grid"></div>
          <div className="route-line"></div>
          <span className="map-pin pickup-pin">A</span><span className="map-pin drop-pin">B</span>
          <div className="map-card"><span className="mini-dot"></span><div><b>Ready when you are</b><small>Request a route quote to begin</small></div><span className="arrow">↗</span></div>
          <div className="float-card"><span className="float-icon">↗</span><div><small>Built for your city</small><b>Move with confidence</b></div></div>
        </div>
      </section>

      <section className="service-strip">
        <article><span className="service-icon">↗</span><div><h3>Smart rides</h3><p>Compare Bike, Car and Premium with server-calculated fare and traffic-aware ETA.</p></div></article>
        <article><span className="service-icon">⌂</span><div><h3>Vehicle rentals</h3><p>Browse approved vehicles and reserve time slots without overlap.</p></div></article>
        <article><span className="service-icon">♡</span><div><h3>Safety by design</h3><p>Women Safety preferences, trip sharing and reviewable incident records.</p></div></article>
      </section>
      <section className="feature-quicklinks" aria-label="DRIVE feature areas">
        <button onClick={()=>setTab("shared")}><span>⇄</span><b>Shared rides</b><small>Compatible riders and cost split</small></button>
        <button onClick={()=>setTab("safety")}><span>♡</span><b>Women Safety</b><small>Trusted contacts and live share links</small></button>
        <button onClick={()=>setTab("explore")}><span>⌖</span><b>Tourist Mode</b><small>Nearby places and multi-stop routes</small></button>
        <button onClick={()=>setTab("account")}><span>◎</span><b>Driver & owner</b><small>Apply, manage, and review activity</small></button>
      </section>

      {!firebaseReady && <div className="setup-banner" role="status"><b>Setup required:</b> add the Firebase Web app values to <code>apps/web/.env.local</code>. The website intentionally disables data and sign-in until configured.</div>}
      {error && <div className="alert error global-alert" role="alert"><span>{error}</span><button onClick={() => setError("")} aria-label="Dismiss error">×</button></div>}
      {notice && <div className="alert success global-alert" role="status"><span>{notice}</span><button onClick={() => setNotice("")} aria-label="Dismiss notice">×</button></div>}

      <section className="workspace" aria-label="DRIVE web services">
        <div className="section-heading"><div><p className="eyebrow">YOUR DRIVE</p><h2>{pageTitle[tab]}</h2></div><span className="section-tag">BANGLADESH · BDT</span></div>
        {tab === "ride" && <div className="workspace-grid">
          <div className="panel booking-panel">
            <div className="panel-title"><span className="panel-number">01</span><div><h3>Where are you going?</h3><p>Search a pickup and destination to get a trusted quote.</p></div></div>
            <PlaceField label="Pickup location" signedIn={Boolean(user)} onNeedAuth={() => setAuthOpen(true)} onResolved={point => {setPickup(point);setQuote(null);}} />
            <PlaceField label="Destination" signedIn={Boolean(user)} onNeedAuth={() => setAuthOpen(true)} onResolved={point => {setDestination(point);setQuote(null);}} />
            <div className="field"><label>Choose a ride</label><div className="vehicle-options">
              {([{id:"bike",label:"Bike",glyph:"↗"},{id:"car",label:"Car",glyph:"▰"},{id:"premium",label:"Premium",glyph:"✦"}] as const).map(v =>
                <button key={v.id} className={"vehicle-option " + (vehicleType === v.id ? "chosen" : "")} onClick={() => {setVehicleType(v.id);setQuote(null);}}>
                  <span>{v.glyph}</span><b>{v.label}</b>
                </button>)}
            </div></div>
            <label className="toggle-row ride-preference"><span><b>Find compatible co-riders</b><small>Join a shared-ride search and split the organizer's estimated BDT fare.</small></span><input type="checkbox" checked={shareRide} onChange={e=>{setShareRide(e.target.checked);setQuote(null);}}/></label>
            <div className="field"><label>Display currency</label><select value={displayCurrency} onChange={e=>setDisplayCurrency(e.target.value)}><option value="BDT">BDT · Bangladeshi taka</option><option value="USD">USD · US dollar</option><option value="EUR">EUR · Euro</option><option value="GBP">GBP · Pound sterling</option><option value="INR">INR · Indian rupee</option><option value="AUD">AUD · Australian dollar</option><option value="CAD">CAD · Canadian dollar</option><option value="SGD">SGD · Singapore dollar</option><option value="JPY">JPY · Japanese yen</option><option value="SAR">SAR · Saudi riyal</option><option value="AED">AED · UAE dirham</option></select></div>
            <button className="button primary full" disabled={busy || !firebaseReady} onClick={() => void getQuote()}>{busy ? "Working…" : "Get fare estimate"}</button>
            <p className="tiny muted">The server owns the payable BDT quote. Estimates expire after five minutes; display conversion is indicative only.</p>
          </div>
          <div className="panel quote-panel">
            {!quote ? <div className="empty-state"><div className="empty-icon">⌖</div><h3>Your route starts here</h3><p>Choose both locations to see distance, estimated time and BDT fare.</p><div className="route-preview"><span></span><i></i><span></span></div></div>
              : <div className="quote-content"><p className="eyebrow">YOUR ESTIMATE · SERVER CALCULATED</p><div className="fare-total">{formatDisplayFare(quote.fare.totalMinor)}</div><p className="muted">Indicative display total · {displayCurrency}</p>{displayCurrency!=="BDT"&&<p className="tiny muted">Payable quote remains {formatBdt(quote.fare.totalMinor)} BDT. {fxDate?"Rate date: "+fxDate+" · "+fxSource:""}{fxError?" · "+fxError:""}</p>}<div className="route-stats"><div><small>Distance</small><b>{formatDistance(quote.route.distanceMeters)}</b></div><div><small>ETA</small><b>{formatDuration(quote.route.durationSeconds)}</b></div></div><div className="fare-breakdown"><div><span>Base fare</span><b>{formatBdt(quote.fare.baseMinor||0)}</b></div><div><span>Distance</span><b>{formatBdt(quote.fare.distanceMinor||0)}</b></div><div><span>Time</span><b>{formatBdt(quote.fare.durationMinor||0)}</b></div><div><span>Service fee</span><b>{formatBdt(quote.fare.serviceFeeMinor||0)}</b></div>{Number(quote.fare.surgeExtraMinor||0)>0&&<div><span>Surge adjustment</span><b>{formatBdt(quote.fare.surgeExtraMinor||0)}</b></div>}<div className="fare-breakdown-total"><span>Estimated payable fare</span><b>{formatBdt(quote.fare.totalMinor)}</b></div></div>{quote.warning && <div className="alert warning">{quote.warning}</div>}<div className="route-points"><span><i className="route-point green"></i><div><small>Pickup</small><b>{pickup?.label}</b></div></span><span><i className="route-point coral"></i><div><small>Destination</small><b>{destination?.label}</b></div></span></div><div className="ml-insight"><div className="ml-heading"><b>Smart fare & ETA insight</b><span className="pill">{mlInsight?.modelStatus||"loading"}</span></div>{!mlInsight?<p className="muted tiny">Checking whether the experimental ML service is available…</p>:<><p className="muted tiny">{mlInsight.note||mlInsight.warning||"Experimental insight only; it never changes your payable quote."}</p>{mlInsight.baseline&&<p className="tiny">Baseline ETA: {mlInsight.baseline.etaMinutes} min · authoritative BDT fare: {formatBdt(mlInsight.baseline.authoritativeFareMinor||quote.fare.totalMinor)}</p>}</>}</div><button className="button primary full" disabled={busy} onClick={() => void requestRide()}>{busy ? "Requesting…" : shareRide ? "Find compatible co-riders" : "Request this ride"}</button><p className="tiny muted">{shareRide?"Shared fare is provisional until the organizer confirms a compatible group.":"Requesting creates a ride request; it does not guarantee a driver has accepted."}</p></div>}
          </div>
        </div>}

        {tab === "rentals" && <div className="rental-layout">
          <div className="panel rental-search">
            <p className="eyebrow">RENTAL MARKETPLACE</p><h3>Choose your time window</h3><p className="muted">Only approved, rental-enabled listings are shown.</p>
            <div className="field"><label>Start</label><input type="datetime-local" value={rentalStart} onChange={e => setRentalStart(e.target.value)} /></div>
            <div className="field"><label>End</label><input type="datetime-local" value={rentalEnd} onChange={e => setRentalEnd(e.target.value)} /></div>
            <p className="tiny muted">Reservations are validated and locked by the backend. Overlapping requests will be rejected.</p>
          </div>
          <div className="panel rental-filter-row"><div className="field"><label>Vehicle type</label><select value={rentalType} onChange={e=>setRentalType(e.target.value)}><option value="all">All types</option><option value="bike">Bike</option><option value="car">Car</option><option value="premium">Premium</option></select></div><div className="field"><label>Area</label><input value={rentalArea} onChange={e=>setRentalArea(e.target.value)} placeholder="Filter by area"/></div><div className="field"><label>Max BDT / hour</label><input type="number" min="0" value={rentalMaxPrice} onChange={e=>setRentalMaxPrice(e.target.value)} placeholder="No limit"/></div></div>
          <div className="vehicle-list">
            {!firebaseReady ? <div className="panel empty-state"><h3>Connect Firebase to view rentals</h3></div>
              : filteredVehicles.length === 0 ? <div className="panel empty-state"><h3>No matching vehicles</h3><p>Try changing the category, area or hourly price. Only approved rental-enabled listings are shown.</p></div>
              : filteredVehicles.map(vehicle => <article className="panel vehicle-card" key={vehicle.id}><div className="vehicle-art"><span>{vehicle.type === "bike" ? "↗" : "▰"}</span></div><div className="vehicle-details"><div className="vehicle-topline"><span className="pill">APPROVED</span><span className="muted small">{vehicle.area || "Bangladesh"}</span></div><h3>{vehicle.model || "DRIVE rental vehicle"}</h3><p className="muted">{vehicle.type || "Vehicle"} · {vehicle.seatCount || "—"} seats</p><div className="vehicle-price">{formatBdt(vehicle.rentalRatePerHourMinor || 0)} <small>/ hour</small></div>{Number.isFinite(new Date(rentalStart).getTime())&&Number.isFinite(new Date(rentalEnd).getTime())&&new Date(rentalEnd).getTime()>new Date(rentalStart).getTime()&&<p className="tiny muted">Estimated total: {formatBdt(Math.ceil((new Date(rentalEnd).getTime()-new Date(rentalStart).getTime())/3600000)*(vehicle.rentalRatePerHourMinor||0))} · server confirms the total.</p>}<button className="button primary compact" disabled={busy} onClick={() => void bookRental(vehicle.id)}>Reserve vehicle</button></div></article>)}
          </div>
          {user && <div className="panel booking-history"><h3>Your rental bookings</h3>{bookings.length === 0 ? <p className="muted">Your confirmed reservations will appear here.</p> : bookings.map(booking => <div className="history-row" key={booking.id}><div><b>{booking.vehicleId || "Rental vehicle"}</b><small>{booking.status || "pending"} · {booking.startAt?.toDate?.().toLocaleString() || "Start time pending"}</small></div><b>{formatBdt(booking.totalMinor || 0)}</b>{booking.status === "confirmed" && <button className="button outline compact" disabled={busy} onClick={() => void cancelRental(booking.id)}>Cancel</button>}</div>)}</div>}
        </div>}

        {tab === "trips" && <div className="panel trips-panel"><div className="panel-title"><span className="panel-number">02</span><div><h3>Recent rides</h3><p>Live status, tracking, trip chat, reviews, support cases and payment state.</p></div></div>{!user ? <div className="empty-state"><h3>Sign in to view your trips</h3><button className="button primary" onClick={() => setAuthOpen(true)}>Sign in</button></div> : rides.length === 0 ? <div className="empty-state"><h3>No rides yet</h3><p>Your trip history will appear here after you request a ride.</p><button className="button primary" onClick={()=>setTab("ride")}>Book your first ride</button></div> : <div className="trip-card-list">{rides.map(ride=><TripCard key={ride.id} ride={ride} user={user} payment={payments[ride.id]} onError={setError} onNotice={setNotice}/>)}</div>}</div>}
        {tab === "shared" && <SharedRidePage user={user} onNeedAuth={()=>setAuthOpen(true)} onError={setError} onNotice={setNotice} onBooked={rideId=>{setNotice("Shared ride "+rideId+" created.");setTab("trips");}}/>}
        {tab === "safety" && <SafetyPage user={user} rides={rides} onNeedAuth={()=>setAuthOpen(true)} onError={setError} onNotice={setNotice}/>}
        {tab === "explore" && <TouristPage user={user} onNeedAuth={()=>setAuthOpen(true)} onError={setError} onNotice={setNotice}/>}
        {tab === "account" && <AccountPage user={user} onNeedAuth={()=>setAuthOpen(true)} onError={setError} onNotice={setNotice}/>}

      </section>
    </main>

    <footer className="footer"><a href="#home" className="brand"><span className="brand-mark small-mark">↝</span><span>DRIVE</span></a><span>Move with confidence.</span><span>© DRIVE · Bangladesh</span><p className="tiny muted">Academic project. Emergency reports are not a substitute for emergency services. Stripe is test-mode only until separately approved.</p></footer>
    {authOpen && <AuthPanel onClose={() => setAuthOpen(false)} />}
  </div>;
}