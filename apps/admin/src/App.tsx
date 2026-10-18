import {useEffect, useState} from "react";
import type {FormEvent} from "react";
import {onAuthStateChanged, signInWithEmailAndPassword, signOut, type User} from "firebase/auth";
import {collection, onSnapshot, orderBy, query, where, type DocumentData} from "firebase/firestore";
import {httpsCallable} from "firebase/functions";
import {auth, db, firebaseReady, functions} from "./firebase";

type Listing = DocumentData & {id: string; model?: string; type?: string; area?: string; ownerId?: string; seatCount?: number; rentalRatePerHourMinor?: number; approvalStatus?: string; createdAt?: {toDate?: () => Date}};
type Decision = {vehicleId: string; approve: boolean};

export default function App() {
  const [user,setUser] = useState<User|null>(null);
  const [isAdmin,setIsAdmin] = useState(false);
  const [email,setEmail] = useState("");
  const [password,setPassword] = useState("");
  const [items,setItems] = useState<Listing[]>([]);
  const [busy,setBusy] = useState<string|null>(null);
  const [notice,setNotice] = useState("");
  const [error,setError] = useState("");

  useEffect(() => {
    if (!auth) return;
    return onAuthStateChanged(auth, async current => {
      setUser(current); setItems([]); setIsAdmin(false);
      if (!current) return;
      try {
        const token = await current.getIdTokenResult(true);
        if (token.claims.admin !== true) {
          setError("This account does not have the server-assigned admin claim.");
          await signOut(auth);
          return;
        }
        setIsAdmin(true); setError("");
      } catch {
        setError("Unable to verify admin permissions. Sign in again.");
      }
    });
  }, []);

  useEffect(() => {
    if (!db || !user || !isAdmin) return;
    return onSnapshot(query(collection(db,"vehicles"),
      where("approvalStatus","==","pending"),orderBy("createdAt","asc")),
      snapshot => { setItems(snapshot.docs.map(d=>({id:d.id,...d.data()}))); setError(""); },
      () => setError("Could not load pending vehicles. Verify Firestore rules and admin claim."));
  }, [user,isAdmin]);

  async function login(event:FormEvent) {
    event.preventDefault(); setError(""); setNotice("");
    if (!auth) return;
    try { await signInWithEmailAndPassword(auth,email.trim(),password); setPassword(""); }
    catch { setError("Sign-in failed. Check credentials and Firebase Auth configuration."); }
  }

  async function decide(item:Listing, approve:boolean) {
    if (!functions || busy) return;
    const decision:Decision = {vehicleId:item.id,approve};
    setBusy(item.id); setError(""); setNotice("");
    try {
      const call = httpsCallable<Decision,{status:string}>(functions,"reviewRentalVehicle");
      const result = await call(decision);
      setNotice(`${item.model ?? "Vehicle"}: ${result.data.status}.`);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unknown error";
      setError(`Decision was not confirmed: ${message}`);
    } finally { setBusy(null); }
  }

  if (!firebaseReady) return <main className="shell"><section className="panel">
    <p className="eyebrow">DRIVE · OPERATIONS</p><h1>Admin configuration required</h1>
    <p>Copy <code>.env.example</code> to <code>.env.local</code> and add your Firebase Web app configuration. Do not add service-account keys or Stripe secrets.</p>
  </section></main>;

  return <main className="shell">
    <header className="top"><div><p className="eyebrow">DRIVE · OPERATIONS CONSOLE</p><h1>Vehicle approvals</h1><p className="muted">FR-03 · Review pending rental listings</p></div>
      {user && <button className="quiet" onClick={()=>auth && signOut(auth)}>Sign out</button>}
    </header>
    {error && <div className="alert error" role="alert">{error}</div>}
    {notice && <div className="alert success" role="status">{notice}</div>}
    {!user ? <section className="panel login"><h2>Administrator sign-in</h2>
      <p className="muted">Only accounts with a server-assigned admin claim can access this console.</p>
      <form onSubmit={login}><label>Email<input type="email" autoComplete="username" required value={email} onChange={e=>setEmail(e.target.value)}/></label>
      <label>Password<input type="password" autoComplete="current-password" required value={password} onChange={e=>setPassword(e.target.value)}/></label>
      <button className="primary" type="submit">Sign in securely</button></form>
    </section> : !isAdmin ? <section className="panel"><p>Verifying administrator access…</p></section> :
      <><div className="stats"><div className="panel"><span className="muted">Pending review</span><strong>{items.length}</strong></div><div className="panel"><span className="muted">Signed in as</span><strong className="identity">{user.email ?? user.uid}</strong></div></div>
      {items.length === 0 ? <section className="panel empty"><h2>All caught up</h2><p className="muted">There are no pending vehicle listings right now.</p></section> :
      <section className="listing-grid">{items.map(item=><article className="panel listing" key={item.id}>
        <div className="listing-top"><span className="pill">{item.type ?? "vehicle"}</span><span className="pending">Pending</span></div>
        <h2>{item.model ?? "Unnamed vehicle"}</h2><p className="muted">{item.area ?? "Area not provided"}</p>
        <dl><div><dt>Seats</dt><dd>{item.seatCount ?? "—"}</dd></div><div><dt>Hourly rate</dt><dd>৳{((Number(item.rentalRatePerHourMinor)||0)/100).toFixed(2)}</dd></div><div><dt>Owner UID</dt><dd className="uid">{item.ownerId ?? "—"}</dd></div><div><dt>Vehicle ID</dt><dd className="uid">{item.id}</dd></div></dl>
        <p className="muted small">Private registration/plate details are intentionally not shown in this approval list.</p>
        <div className="actions"><button className="primary" disabled={busy!==null} onClick={()=>decide(item,true)}>{busy===item.id?"Saving…":"Approve listing"}</button><button className="danger" disabled={busy!==null} onClick={()=>decide(item,false)}>Reject</button></div>
      </article>)}</section>}
      <footer>Approval is executed by the server callable. Browser clients cannot write vehicle approval fields directly.</footer>
      </>}
  </main>;
}
