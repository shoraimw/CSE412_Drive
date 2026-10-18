import {useState} from "react";
import type {FormEvent} from "react";
import {callAdmin} from "./admin_api";

type Account = {
  uid:string;
  email:string|null;
  phoneMasked:string|null;
  emailVerified:boolean;
  disabled:boolean;
  createdAt:string|null;
  lastSignInAt:string|null;
  adminClaim:boolean;
  driverClaim:boolean;
  accountStatus:string;
  displayName:string|null;
  locale:string|null;
};

function Value({name,value}: {name:string;value:unknown}) {
  const text=value===null||value===undefined ? "—"
    : typeof value==="boolean" ? (value?"Yes":"No") : String(value);
  return <div><dt>{name}</dt><dd>{text}</dd></div>;
}

export default function AccountLookup() {
  const [query,setQuery]=useState("");
  const [result,setResult]=useState<Account|null>(null);
  const [error,setError]=useState("");
  const [working,setWorking]=useState(false);

  async function search(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if(working)return;
    const term=query.trim();
    if(term.length<5 || term.length>254) {
      setError("Provide a complete user UID or email address.");
      return;
    }
    setWorking(true);
    setError("");
    setResult(null);
    try{
      const response=await callAdmin("lookupAdminUser",{identifier:term});
      setResult(response as Account);
    }catch(e) {
      setError(e instanceof Error?e.message:"Account lookup failed.");
    }finally{setWorking(false);}
  }

  return <section className="panel">
    <div className="section-heading"><div>
      <h2>Exact account lookup</h2>
      <p>Authenticated administrator access only. Searches are rate-limited
        and audited on the server; account lists are never bulk-exported.</p>
    </div></div>
    <form className="account-search" onSubmit={e=>void search(e)}>
      <label htmlFor="account-identifier">Full Firebase UID or email address
        <input id="account-identifier" autoComplete="off" required
          value={query} maxLength={254} placeholder="user@example.com or exact UID"
          onChange={e=>setQuery(e.target.value)}/>
      </label>
      <button className="primary" type="submit"
        disabled={working||query.trim().length<5}>
        {working?"Searching…":"Find account"}
      </button>
    </form>
    {error&&<div role="alert" className="alert error">{error}</div>}
    {result&&<div className="user-result" aria-live="polite">
      <div className="between">
        <h3>{result.displayName||"Registered account"}</h3>
        <span className={"pill "+(result.disabled?"bad":"good")}>
          {result.disabled?"Firebase Auth disabled":"Firebase Auth enabled"}
        </span>
      </div>
      <dl className="detail-grid">
        <Value name="Firebase UID" value={result.uid}/>
        <Value name="Email" value={result.email}/>
        <Value name="Email verified" value={result.emailVerified}/>
        <Value name="Phone (masked)" value={result.phoneMasked}/>
        <Value name="Account status in profile" value={result.accountStatus}/>
        <Value name="Driver custom claim" value={result.driverClaim}/>
        <Value name="Admin custom claim" value={result.adminClaim}/>
        <Value name="Locale" value={result.locale}/>
        <Value name="Created at" value={result.createdAt}/>
        <Value name="Last sign-in" value={result.lastSignInAt}/>
      </dl>
      <p className="muted small">Read-only account diagnostics. Identity,
        roles and disabled state cannot be changed in the browser. Formal
        suspension and appeals workflows require further server and policy review.</p>
    </div>}
  </section>;
}
