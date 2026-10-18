import {useEffect, useState} from "react";
import type {FormEvent, ReactNode} from "react";
import {
  onAuthStateChanged, signInWithEmailAndPassword, signOut, type User
} from "firebase/auth";
import {auth, firebaseReady} from "./firebase";
import {
  menu, pendingStream, activityRows, loadOverview,
  callAdmin, activePricing, queueTab, activityTab, calendarTime,
  type AdminRow, type Tab, type QueueTab, type OverviewData
} from "./admin_api";
import {
  bdt, categories, demoRates, allRateFields, moneyFields,
  parseRatePlan, recentStatusCounts, shortId, validateFarePlan,
  type FarePlan, type RateField, type VehicleCategory
} from "./admin_domain";

const text = (value:unknown):string =>
  value===undefined||value===null||value==="" ? "—" : String(value);
const labelStatus=(v:unknown):string=>text(v).replaceAll("_"," ");
const get = (row:AdminRow,key:string):string=>text(row[key]);
const currencyFromFare=(value:unknown):string=>{
  if (value===null||typeof value!=="object") return "—";
  return bdt((value as Record<string,unknown>).totalMinor);
};

function Pill({value}: {value:unknown}) {
  const word=text(value);
  const normalized=word.toLowerCase();
  const kind=["approved","completed","resolved","paid_test"].includes(normalized)
    ? "good" : ["rejected","dismissed","cancelled","payment_failed"].includes(normalized)
    ? "bad" : ["open","pending","matching","in_review","cash_due"].includes(normalized)
    ? "warn" : "neutral";
  return <span className={"pill "+kind}>{labelStatus(word)}</span>;
}
function Empty({title,sub}: {title:string;sub:string}) {
  return <div className="empty-state">
    <div className="empty-icon" aria-hidden="true">◇</div>
    <h3>{title}</h3><p>{sub}</p>
  </div>;
}
function Metric({label,value,detail}: {label:string;value:string|number;detail:string}) {
  return <div className="metric">
    <span className="metric-label">{label}</span>
    <strong>{value}</strong><small>{detail}</small>
  </div>;
}
function Card({children,className=""}: {children:ReactNode;className?:string}) {
  return <section className={"panel "+className}>{children}</section>;
}
function field(row:AdminRow,key:string,label:string):ReactNode {
  return <div><dt>{label}</dt><dd>{get(row,key)}</dd></div>;
}
function created(row:AdminRow):string {
  return calendarTime(row.createdAt ?? row.submittedAt);
}
function Overview({stats}: {stats:OverviewData|null}) {
  if (!stats) return <Card><p>Loading recent operational activity…</p></Card>;
  const rideCounts=recentStatusCounts(stats.rides);
  const paymentCounts=recentStatusCounts(stats.payments);
  const active=stats.rides.filter(r=>["matching","accepted","driver_arriving","in_progress"].includes(text(r.status))).length;
  const pendingCash=stats.payments.filter(p=>p.status==="cash_due").length;
  const openSafety=stats.safety.filter(p=>p.status==="open"||p.status==="in_review").length;
  const counts=Object.entries(rideCounts).sort((a,b)=>b[1]-a[1]);
  const top=Math.max(1,...counts.map(([,count])=>count));
  return <>
    <div className="metrics">
      <Metric label="Recent rides" value={stats.rides.length} detail="Latest 40 sampled records"/>
      <Metric label="Active ride records" value={active} detail="Among the 40 sampled rides"/>
      <Metric label="Unverified cash due" value={pendingCash} detail="Among recent 40 payments"/>
      <Metric label="Safety incidents awaiting work" value={openSafety} detail="Among recent 40 incident records"/>
    </div>
    <div className="section-grid">
      <Card>
        <div className="section-heading"><div><h2>Ride status breakdown</h2><p>Sampled last 40 records only</p></div></div>
        {counts.length===0 ? <Empty title="No trips yet" sub="Trip activity appears here as drivers complete rides."/> :
          <div className="bars">{counts.map(([name,count])=><div className="barrow" key={name}>
            <span>{labelStatus(name)}</span>
            <div className="bar-track"><span style={{width:(count/top*100)+"%"}}/></div>
            <strong>{count}</strong>
          </div>)}</div>}
      </Card>
      <Card>
        <h2>Operational checks</h2>
        <p className="muted">A source-level monitoring view, not a settlement ledger or full analytics warehouse.</p>
        <div className="checklist">
          <div><span className="dot green"/><span>Firebase role-gated administrative reads</span></div>
          <div><span className="dot green"/><span>Backend-only approval and pricing changes</span></div>
          <div><span className="dot amber"/><span>{stats.rentals.length} recent rentals sampled</span></div>
          <div><span className="dot amber"/><span>{stats.payments.length} recent payments sampled; none counted as live revenue</span></div>
          <div><span className="dot amber"/><span>{paymentCounts.paid_test||0} Stripe TEST records in sample (not real funds)</span></div>
        </div>
      </Card>
    </div>
    <p className="sample-note">
      Snapshot sample is capped at 40 per collection. These metrics are <strong>not</strong>
      whole-platform totals. {stats.truncated?"One or more samples reached the cap.":""}
      For millions of users, deploy aggregate counters and BigQuery before reporting complete analytics.
    </p>
  </>;
}

type Review={
  tab:QueueTab|"safety";
  row:AdminRow;
  approve?:boolean;
  next?: "in_review"|"resolved"|"dismissed";
};
function ReviewDialog({review,busy,onClose,onSubmit}:{
  review:Review;busy:boolean;onClose:()=>void;
  onSubmit:(reason:string)=>void;
}) {
  const [reason,setReason]=useState("");
  const kind=review.tab==="safety"
    ? "Update incident" : review.approve ? "Approve" : "Reject";
  const subject=get(review.row,review.tab==="vehicles"?"model":"uid");
  const valid=reason.trim().length>=10&&reason.trim().length<=400;
  return <div className="modal-backdrop" role="presentation">
    <section className="dialog" role="dialog" aria-modal="true" aria-labelledby="review-heading">
      <p className="eyebrow">SERVER-AUTHORIZED DECISION</p>
      <h2 id="review-heading">{kind} {review.tab==="safety"?"safety case":review.tab.slice(0,-1)}</h2>
      <p className="muted">Subject: <code>{shortId(subject==="—"?review.row.id:subject)}</code></p>
      {review.tab==="safety" ? <p>
        Status: <strong>{get(review.row,"status")}</strong> → <strong>{review.next}</strong>.
        This internal action does not contact emergency services.
      </p> : <p>
        A decision will update the server-owned record; permissions are checked
        again by Cloud Functions before anything is committed.
      </p>}
      <label htmlFor="review-reason">Review rationale (10–400 characters)</label>
      <textarea id="review-reason" rows={4} maxLength={400}
        autoFocus value={reason} onChange={e=>setReason(e.target.value)}
        placeholder="Write a factual reason that can be audited."/>
      <div className="dialog-actions">
        <button className="quiet" disabled={busy} onClick={onClose}>Cancel</button>
        <button className={review.approve===false||review.next==="dismissed"?"danger":"primary"}
          disabled={busy||!valid} onClick={()=>onSubmit(reason.trim())}>
          {busy?"Submitting…":"Confirm decision"}
        </button>
      </div>
    </section>
  </div>;
}

function Queue({tab,rows,onReview}:{
  tab:QueueTab;rows:AdminRow[];onReview:(r:Review)=>void;
}) {
  return rows.length===0
    ? <Card><Empty title="Queue is clear" sub="There are no pending records in this bounded live queue."/></Card>
    : <div className="cards">
      {rows.map(row=><article className="panel review-card" key={row.id}>
        <div className="between"><Pill value="pending"/><span className="meta">{created(row)}</span></div>
        <h3>{tab==="vehicles"?get(row,"model"):tab==="drivers"?"Driver application":get(row,"businessName")}</h3>
        <div className="keyline">{tab==="vehicles"?get(row,"type"):tab==="drivers"?get(row,"vehicleType"):"Vehicle owner"}</div>
        <dl className="detail-grid">
          {tab==="drivers"&&<>{field(row,"vehicleModel","Vehicle model")}{field(row,"vehicleType","Category")}</>}
          {tab==="vehicles"&&<><div><dt>Hourly rental rate</dt><dd>{bdt(row.rentalRatePerHourMinor)}</dd></div>{field(row,"area","Service area")}{field(row,"seatCount","Seats")}</>}
          {tab==="owners"&&field(row,"businessName","Business")}
          {field(row,tab==="vehicles"?"ownerId":"uid","Account ID")}
          <div><dt>Record ID</dt><dd className="code-compact">{shortId(row.id)}</dd></div>
        </dl>
        {tab==="drivers"&&<p className="muted small">
          Driver documents must be reviewed through an authorized private review process,
          not downloaded or publicly exposed from this list.
        </p>}
        <div className="card-actions">
          <button className="primary" onClick={()=>onReview({tab,row,approve:true})}>Approve</button>
          <button className="danger" onClick={()=>onReview({tab,row,approve:false})}>Reject</button>
        </div>
      </article>)}
    </div>;
}

function Operations({tab,rows,onReview}:{
  tab:"rides"|"rentals"|"payments"|"safety"|"audit";
  rows:AdminRow[];
  onReview:(r:Review)=>void;
}) {
  const config:{
    [key in typeof tab]:{heading:string;description:string}
  }={
    rides:{heading:"Recent trips",description:"Read-only status, vehicle type and fare. Exact GPS not exposed here."},
    rentals:{heading:"Recent rental bookings",description:"Read-only rental availability and price records."},
    payments:{heading:"Payment record inspection",description:"Stripe TEST is not live revenue; cash reports are unverified."},
    safety:{heading:"Safety case triage",description:"Internal statuses only; no contacts or emergency dispatch are notified."},
    audit:{heading:"Immutable operational trail",description:"Backend-originated approvals, pricing and incident decisions."},
  };
  return <Card>
    <div className="section-heading"><div><h2>{config[tab].heading}</h2><p>{config[tab].description}</p></div></div>
    {rows.length===0?<Empty title="No recent records" sub="No records were returned for this operational view."/>:
      <div className="table-scroll"><table><thead><tr>
        <th scope="col">Record</th><th scope="col">Time</th>
        <th scope="col">Type / association</th><th scope="col">State</th>
        <th scope="col">Amount / detail</th><th scope="col">Action</th>
      </tr></thead><tbody>{rows.map(row=><tr key={row.id}>
        <td><code title={row.id}>{shortId(row.id)}</code></td>
        <td className="nowrap">{created(row)}</td>
        <td>{tab==="rides"?text(row.vehicleType)
          :tab==="rentals"?<span title={text(row.vehicleId)}>Vehicle {shortId(row.vehicleId)}</span>
          :tab==="payments"?text(row.method)
          :tab==="safety"?text(row.type)
          :text(row.type)}</td>
        <td><Pill value={tab==="audit"? "logged": row.status??"recorded"}/></td>
        <td>{tab==="rides"?currencyFromFare(row.finalFare??row.fare)
          :tab==="rentals"?bdt(row.totalMinor)
          :tab==="payments"?bdt(row.amountMinor)
          :tab==="safety"?<span title={text(row.note)}>{text(row.note).slice(0,90)}</span>
          :<span title={text(row.subjectId??row.actorId)}>{shortId(row.subjectId??row.actorId)}</span>}</td>
        <td>{tab==="safety"&&row.status==="open"
          ? <button className="secondary smallbutton" onClick={()=>onReview({tab,row,next:"in_review"})}>Start review</button>
          :tab==="safety"&&row.status==="in_review"
          ? <div className="row-actions">
            <button className="secondary smallbutton" onClick={()=>onReview({tab,row,next:"resolved"})}>Resolve</button>
            <button className="quiet smallbutton" onClick={()=>onReview({tab,row,next:"dismissed"})}>Dismiss</button>
          </div>
          :<span className="muted small">Read-only</span>}</td>
      </tr>)}</tbody></table></div>}
    <p className="sample-note">
      Bounded to 60 newest records. Use a backend reporting pipeline and cursor-based
      pagination for complete history; browser-side lists are not platform totals.
    </p>
  </Card>;
}

function Pricing() {
  const [plan,setPlan]=useState<FarePlan>(demoRates);
  const [active,setActive]=useState("");
  const [version,setVersion]=useState("");
  const [confirmation,setConfirmation]=useState("");
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [notice,setNotice]=useState("");
  const [loaded,setLoaded]=useState(false);
  async function refresh() {
    setLoading(true); setError("");
    try {
      const config=await activePricing();
      const prior=parseRatePlan(config.vehicles);
      setActive(config.activeVersion);
      setLoaded(prior!==null);
      setPlan(prior??demoRates);
    } catch {
      setError("Could not load active price configuration.");
    } finally {setLoading(false);}
  }
  useEffect(()=>{void refresh();},[]);
  const issues=validateFarePlan(version,plan);
  const change=(cat:VehicleCategory,field:RateField,val:string)=>{
    setPlan(old=>({...old,[cat]:{...old[cat],[field]:Number(val)}}));
    setConfirmation("");
  };
  async function submit() {
    if (issues.length||confirmation!=="PUBLISH "+version||busy) return;
    setBusy(true);setError("");setNotice("");
    try {
      const result=await callAdmin("publishPricingConfig",{version,vehicles:plan});
      setNotice("Pricing version "+text(result.version)+" published. Existing accepted quotes are not silently rewritten.");
      setVersion("");setConfirmation("");await refresh();
    } catch(e) {
      setError(e instanceof Error?e.message:"Unable to publish pricing.");
    } finally {setBusy(false);}
  }
  return <Card>
    <div className="section-heading"><div>
      <h2>Versioned BDT pricing</h2>
      <p>All amounts in minor units. Changes apply to new quotes through server validation.</p>
    </div><span className="pill neutral">Current: {active||"not seeded"}</span></div>
    {loading?<p>Loading current pricing…</p>:<>
      {!loaded&&<p className="alert warning">
        Current pricing could not be loaded. The form contains DEMO examples,
        not verified production prices. Seed the active config first.
      </p>}
      <div className="table-scroll"><table className="pricing-table"><thead><tr>
        <th>Vehicle</th>
        {allRateFields.map(x=><th key={x}>{x}</th>)}
      </tr></thead><tbody>{categories.map(cat=><tr key={cat}>
        <th>{cat}</th>
        {allRateFields.map(field=><td key={field}>
          <input aria-label={cat+" "+field} type="number" min={moneyFields.includes(field)?0:1}
            max={moneyFields.includes(field)?10000000:5}
            step={moneyFields.includes(field)?1:0.05}
            value={plan[cat][field]} onChange={e=>change(cat,field,e.target.value)}/>
        </td>)}
      </tr>)}</tbody></table></div>
      <p className="muted small">baseMinor / minMinor / serviceFeeMinor and
        perKmMinor / perMinuteMinor are BDT × 100. Surge is a capped multiplier.
        The server checks exact schema and refuses an existing version ID.</p>
      <div className="publish-fields">
        <label>New unique version ID
          <input placeholder="bdt-2026-10-v2" value={version}
            onChange={e=>{setVersion(e.target.value);setConfirmation("");}}/>
        </label>
        <label>Type PUBLISH followed by the exact version to confirm
          <input placeholder={"PUBLISH "+(version||"version-id")}
            value={confirmation} onChange={e=>setConfirmation(e.target.value)}/>
        </label>
      </div>
      {issues.length>0&&version.length>0&&
        <ul className="validation" role="alert">{issues.slice(0,5).map(x=><li key={x}>{x}</li>)}</ul>}
      <button className="primary"
        disabled={loading||busy||issues.length>0||confirmation!=="PUBLISH "+version}
        onClick={()=>void submit()}>{busy?"Publishing…":"Publish new pricing version"}</button>
      {error&&<p className="alert error" role="alert">{error}</p>}
      {notice&&<p className="alert success" role="status">{notice}</p>}
    </>}
  </Card>;
}

export default function App() {
  const [user,setUser]=useState<User|null>(null);
  const [admin,setAdmin]=useState(false);
  const [checking,setChecking]=useState(true);
  const [email,setEmail]=useState("");
  const [password,setPassword]=useState("");
  const [tab,setTab]=useState<Tab>("overview");
  const [rows,setRows]=useState<AdminRow[]>([]);
  const [overview,setOverview]=useState<OverviewData|null>(null);
  const [loading,setLoading]=useState(false);
  const [refresh,setRefresh]=useState(0);
  const [busy,setBusy]=useState(false);
  const [review,setReview]=useState<Review|null>(null);
  const [error,setError]=useState("");
  const [notice,setNotice]=useState("");

  useEffect(()=>{
    if (!auth) {setChecking(false);return;}
    let mounted=true;
    const unsubscribe=onAuthStateChanged(auth,async current=>{
      if(!mounted)return;
      setUser(current);setAdmin(false);setChecking(!!current);setRows([]);
      if(!current)return;
      try{
        const token=await current.getIdTokenResult(true);
        if(!mounted||auth.currentUser?.uid!==current.uid)return;
        if(token.claims.admin!==true){
          setError("This account does not have a trusted administrator claim.");
          await signOut(auth!);
          return;
        }
        setAdmin(true);setError("");
      }catch{
        if(mounted)setError("Could not verify administrator claim. Sign in again.");
      }finally{if(mounted)setChecking(false);}
    });
    return ()=>{mounted=false;unsubscribe();};
  },[]);

  useEffect(()=>{
    if(!admin||!user)return;
    let alive=true;
    setRows([]);setLoading(true);setError("");
    if(queueTab(tab)){
      return pendingStream(tab,
        result=>{if(alive){setRows(result);setLoading(false);}},
        message=>{if(alive){setError(message);setLoading(false);}});
    }
    if(activityTab(tab)){
      void activityRows(tab).then(result=>{
        if(alive){setRows(result);setLoading(false);}
      }).catch(e=>{
        if(alive){setError(e instanceof Error?e.message:"Load failed.");setLoading(false);}
      });
    }else if(tab==="overview"){
      setOverview(null);
      void loadOverview().then(result=>{
        if(alive){setOverview(result);setLoading(false);}
      }).catch(e=>{
        if(alive){setError(e instanceof Error?e.message:"Overview failed.");setLoading(false);}
      });
    }else setLoading(false);
    return ()=>{alive=false;};
  },[tab,admin,user,refresh]);

  async function login(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();setError("");setNotice("");
    if(!auth)return;
    try{
      await signInWithEmailAndPassword(auth,email.trim(),password);
      setPassword("");
    }catch{
      setError("Unable to sign in. Check credentials and Web Firebase configuration.");
    }
  }
  async function logout(){
    if(!auth)return;
    try{await signOut(auth);setTab("overview");setRows([]);}
    catch{setError("Sign-out failed. Try again.");}
  }
  async function complete(reason:string){
    if(!review||busy)return;
    setBusy(true);setError("");setNotice("");
    const item=review;
    try{
      let fn:string;
      let payload:Record<string,unknown>;
      if(item.tab==="safety"){
        fn="reviewSafetyIncident";
        payload={incidentId:item.row.id,expectedStatus:item.row.status,
          nextStatus:item.next,note:reason};
      }else if(item.tab==="vehicles"){
        fn="reviewRentalVehicle";
        payload={vehicleId:item.row.id,approve:item.approve,reason};
      }else{
        fn=item.tab==="drivers"?"reviewDriverApplication":"reviewOwnerApplication";
        payload={uid:item.row.id,approve:item.approve,reason};
      }
      const result=await callAdmin(fn,payload);
      setNotice("Server confirmed "+text(result.status)+". Audit trail recorded where supported.");
      setReview(null);setRefresh(x=>x+1);
    }catch(e){
      setError(e instanceof Error?e.message:"Server rejected the review.");
    }finally{setBusy(false);}
  }
  const title=menu.find(x=>x.id===tab)?.label??"Overview";
  if(!firebaseReady)return <main className="setup-screen"><Card className="login-panel">
    <div className="logo-mark">D</div><p className="eyebrow">DRIVE / ADMINISTRATION</p>
    <h1>Firebase configuration required</h1>
    <p>Copy <code>apps/admin/.env.example</code> to <code>.env.local</code>,
      then supply only Firebase Web app public settings. Never put
      service account or Stripe secrets in your web bundle.</p>
  </Card></main>;

  if(!user||!admin)return <main className="setup-screen"><Card className="login-panel">
    <div className="logo-mark">D</div>
    <p className="eyebrow">DRIVE / SECURE OPERATIONS</p>
    <h1>Operations Console</h1>
    <p className="muted">Only accounts carrying a server-assigned administrator
      custom claim may access operational data. Verification is repeated by Firebase rules and functions.</p>
    {error&&<div className="alert error" role="alert">{error}</div>}
    {checking||user?<p className="muted">Verifying administrator permissions…</p>
      :<form onSubmit={login} className="login-form">
      <label>Email<input type="email" autoComplete="username" required
        value={email} onChange={e=>setEmail(e.target.value)}/></label>
      <label>Password<input type="password" autoComplete="current-password" required
        value={password} onChange={e=>setPassword(e.target.value)}/></label>
      <button className="primary" type="submit">Sign in securely</button>
    </form>}
    <p className="muted small">No administrator account is created through this page.</p>
  </Card></main>;

  return <div className="dashboard">
    <aside className="sidebar">
      <div className="branding"><div className="logo-mark">D</div>
        <div><strong>DRIVE</strong><span>Operations console</span></div>
      </div>
      <nav aria-label="Administrator sections">
        {menu.map((item,index)=><div key={item.id}>
          {(index===0||menu[index-1]?.group!==item.group)&&
            <p className="nav-group">{item.group}</p>}
          <button className={"nav-item "+(tab===item.id?"selected":"")}
            aria-current={tab===item.id?"page":undefined}
            onClick={()=>{setTab(item.id);setNotice("");setError("");}}>
            <span className="nav-symbol" aria-hidden="true">{({
              overview:"▦",drivers:"◎",owners:"♙",vehicles:"◇",
              rides:"↗",rentals:"▣",payments:"৳",safety:"◈",pricing:"⌁",audit:"≡",
            } as Record<Tab,string>)[item.id]}</span>
            <span>{item.label}</span>
          </button>
        </div>)}
      </nav>
      <div className="sidebar-bottom"><small>Internal dashboard · Phase 8</small>
        <strong>{user.email||shortId(user.uid)}</strong>
        <button className="quiet full" onClick={()=>void logout()}>Sign out</button>
      </div>
    </aside>
    <main className="workspace">
      <header className="workspace-top">
        <div><p className="eyebrow">DRIVE / COMMAND CENTER</p>
          <h1>{title}</h1><p className="muted">
            {tab==="overview"?"Recent operational activity and system status."
              :tab==="pricing"?"Audited and server-enforced fare management."
              :tab==="safety"?"Review-only case management; emergency delivery is not active."
              :"Role-gated operations, protected by Firebase rules."}
          </p></div>
        <div className="header-controls">
          <span className="session"><span className="online-dot"/> Authenticated admin</span>
          {tab!=="pricing"&&<button className="secondary"
            onClick={()=>setRefresh(x=>x+1)} disabled={loading}>
            {loading?"Refreshing…":"Refresh"}
          </button>}
        </div>
      </header>
      {error&&<div className="alert error" role="alert">{error}</div>}
      {notice&&<div className="alert success" role="status">{notice}</div>}
      {tab==="pricing"?<Pricing/>:
        tab==="overview"?<Overview stats={overview}/>:
        loading?<Card><p className="muted">Loading bounded records…</p></Card>:
        queueTab(tab)?<Queue tab={tab} rows={rows} onReview={setReview}/>:
        activityTab(tab)?<Operations tab={tab} rows={rows} onReview={setReview}/>:
        null}
      <footer className="workspace-footer">DRIVE CSE412 · No client-side pricing, payment,
        account-role, incident or trip-state writes. Access and changes are authorized server-side.</footer>
    </main>
    {review&&<ReviewDialog key={review.row.id+"_"+(review.next??String(review.approve))}
      review={review} busy={busy}
      onClose={()=>{if(!busy)setReview(null);}}
      onSubmit={reason=>void complete(reason)}/>}
  </div>;
}
