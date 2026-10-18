import {
  collection, getDoc, getDocs, doc, limit, onSnapshot, orderBy, startAfter,
  query, where, type DocumentData, type Unsubscribe, type QueryDocumentSnapshot
} from "firebase/firestore";
import {httpsCallable} from "firebase/functions";
import {db, functions, auth} from "./firebase";

export type AdminRow = {id: string} & Record<string, unknown>;
export type Tab =
  "overview" | "users" | "drivers" | "owners" | "vehicles" |
  "rides" | "rentals" | "payments" | "safety" | "disputes" |
  "pricing" | "audit";
export type QueueTab = "drivers" | "owners" | "vehicles";
export type ActivityTab = "rides" | "rentals" | "payments" | "safety" | "disputes" | "audit";

export const menu: Array<{id: Tab; label: string; group: string}> = [
  {id:"overview",label:"Overview",group:"Monitoring"},
  {id:"users",label:"Account lookup",group:"Monitoring"},
  {id:"drivers",label:"Driver approvals",group:"Verification"},
  {id:"owners",label:"Owner approvals",group:"Verification"},
  {id:"vehicles",label:"Vehicle approvals",group:"Verification"},
  {id:"rides",label:"Ride operations",group:"Operations"},
  {id:"rentals",label:"Rental operations",group:"Operations"},
  {id:"payments",label:"Payment records",group:"Operations"},
  {id:"safety",label:"Safety incidents",group:"Safety"},
  {id:"disputes",label:"Service disputes",group:"Support"},
  {id:"pricing",label:"Pricing controls",group:"Configuration"},
  {id:"audit",label:"Audit history",group:"Safety"},
];
export const queueTab = (tab: Tab): tab is QueueTab =>
  ["drivers","owners","vehicles"].includes(tab);
export const activityTab = (tab: Tab): tab is ActivityTab =>
  ["rides","rentals","payments","safety","disputes","audit"].includes(tab);

const sources: Record<QueueTab,{collection:string;field:string}> = {
  drivers: {collection:"driverApplications",field:"status"},
  owners: {collection:"ownerProfiles",field:"approvalStatus"},
  vehicles: {collection:"vehicles",field:"approvalStatus"},
};
const activitySources: Record<ActivityTab,string> = {
  rides:"rides",
  rentals:"rentalBookings",
  payments:"payments",
  safety:"safetyIncidents",
  disputes:"serviceDisputes",
  audit:"auditEvents",
};
const fromData = (id:string, data:DocumentData):AdminRow=>({...data,id});

export function pendingStream(tab:QueueTab,
  onRows:(rows:AdminRow[])=>void,
  onError:(message:string)=>void): Unsubscribe {
  if (!db) throw new Error("Firebase is not configured.");
  const source = sources[tab];
  // These queues are bounded. Admin can paginate in Phase 9 if needed.
  return onSnapshot(query(collection(db,source.collection),
    where(source.field,"==","pending"),limit(75)),
    snap=>onRows(snap.docs.map(d=>fromData(d.id,d.data()))),
    ()=>onError("Unable to load this approval queue. Check permissions and indexes.")
  );
}

export const activityPageSize=30;
export type ActivityPage={
  rows: AdminRow[];
  cursor: QueryDocumentSnapshot<DocumentData> | null;
};
export async function activityRows(
  tab:ActivityTab,
  after:QueryDocumentSnapshot<DocumentData>|null=null
):Promise<ActivityPage> {
  if (!db) throw new Error("Firebase is not configured.");
  const base=[orderBy("createdAt","desc"),limit(activityPageSize)];
  // Firestore cursor pagination avoids loading enormous historical datasets.
  const q=after
    ? query(collection(db,activitySources[tab]),...base,startAfter(after))
    : query(collection(db,activitySources[tab]),...base);
  const snapshots=await getDocs(q);
  return {
    rows:snapshots.docs.map(d=>fromData(d.id,d.data())),
    cursor:snapshots.docs.length===activityPageSize
      ? snapshots.docs[snapshots.docs.length-1] : null,
  };
}

export type OverviewData = {
  rides: AdminRow[]; rentals: AdminRow[];
  payments: AdminRow[]; safety: AdminRow[];
  truncated: boolean;
};
export async function loadOverview():Promise<OverviewData> {
  if (!db) throw new Error("Firebase is not configured.");
  const [rides,rentals,payments,safety] = await Promise.all([
    "rides","rentalBookings","payments","safetyIncidents",
  ].map(async name=>{
    const snap = await getDocs(query(collection(db!,name),
      orderBy("createdAt","desc"),limit(40)));
    return snap.docs.map(d=>fromData(d.id,d.data()));
  }));
  return {rides,rentals,payments,safety,
    truncated:[rides,rentals,payments,safety].some(x=>x.length===40)};
}

export async function activePricing():Promise<{
  activeVersion:string;
  vehicles:unknown;
}> {
  if (!db) throw new Error("Firebase is not configured.");
  const config=await getDoc(doc(db,"appConfig","public"));
  const version=config.get("activePricingVersion");
  if (typeof version!=="string"||!version) {
    return {activeVersion:"",vehicles:null};
  }
  const current=await getDoc(doc(db,"pricingConfigs",version));
  return {activeVersion:version,vehicles:current.get("vehicles")};
}

export async function callAdmin<TInput extends Record<string,unknown>>(
  name:string, payload:TInput
):Promise<Record<string,unknown>> {
  if (!functions || !auth?.currentUser) {
    throw new Error("Administrator session unavailable.");
  }
  // Fresh claims reduce the stale-role window after an admin is revoked.
  await auth.currentUser.getIdToken(true);
  const callable=httpsCallable<TInput,Record<string,unknown>>(functions,name);
  const result=await callable(payload);
  return result.data;
}

export function calendarTime(value:unknown):string {
  if (value && typeof value==="object" && "toDate" in value &&
    typeof value.toDate==="function") {
    const date = value.toDate() as Date;
    return Number.isFinite(date.getTime()) ? date.toLocaleString("en-BD") : "—";
  }
  return "—";
}
