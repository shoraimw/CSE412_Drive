import {useEffect, useRef, useState} from "react";
import {getBlob, ref} from "firebase/storage";
import {storage} from "./firebase";

type Preview={url:string;mime:string;index:number};
export default function PrivateDocuments({
  uid, documentPaths
}: {uid:string;documentPaths:unknown}) {
  const [preview,setPreview]=useState<Preview|null>(null);
  const [working,setWorking]=useState<number|null>(null);
  const [error,setError]=useState("");
  const urlRef=useRef<string|null>(null);
  const mountedRef=useRef(true);
  useEffect(()=>()=>{mountedRef.current=false;
    if(urlRef.current)URL.revokeObjectURL(urlRef.current);},[]);
  const paths=Array.isArray(documentPaths)&&documentPaths.length===3 &&
    documentPaths.every(x=>typeof x==="string" &&
      x.startsWith("applications/"+uid+"/")&&!x.includes(".."))
      ? documentPaths as string[] : null;

  function clear(){
    if(urlRef.current)URL.revokeObjectURL(urlRef.current);
    urlRef.current=null;setPreview(null);
  }
  async function load(path:string,index:number){
    if(!storage||working!==null)return;
    clear();setError("");setWorking(index);
    try{
      // Private Firebase Storage download using admin Auth + Storage Rules.
      // Never call getDownloadURL: its durable token-bearing URL could leak.
      const blob=await getBlob(ref(storage,path),10*1024*1024);
      if(!["image/jpeg","image/png","image/webp","application/pdf"].includes(blob.type)){
        throw new Error("Unsupported document type.");
      }
      if(!mountedRef.current)return;
      const url=URL.createObjectURL(blob);
      urlRef.current=url;
      setPreview({url,mime:blob.type,index});
    }catch{
      if(mountedRef.current)setError("Unable to read this private document. Verify its type, Storage rules, bucket CORS and admin claim.");
    }finally{if(mountedRef.current)setWorking(null);}
  }
  if(!paths)return <p className="muted small">Three verified document references
    are required before this application can be reviewed.</p>;
  return <div className="private-documents">
    <p className="muted small">Private identity documents (admin access only).
      Preview content is temporary; never share identity records.</p>
    <div className="doc-buttons">
      {paths.map((path,i)=><button key={path} className="secondary smallbutton"
        disabled={!storage||working!==null}
        onClick={()=>void load(path,i)}>
        {working===i?"Opening…":"Document "+(i+1)}
      </button>)}
    </div>
    {!storage&&<p className="muted small">Configure VITE_FIREBASE_STORAGE_BUCKET to review files.</p>}
    {error&&<p className="alert error" role="alert">{error}</p>}
    {preview&&<div className="document-preview">
      <div className="between"><strong>Private document {preview.index+1}</strong>
        <button className="quiet smallbutton" onClick={clear}>Close preview</button></div>
      {preview.mime==="application/pdf"
        ? <a href={preview.url} download={"drive-kyc-"+(preview.index+1)+".pdf"}>
            Download this authenticated private PDF locally for review
          </a>
        : <img alt={"Private verification document "+(preview.index+1)}
            src={preview.url}/>}
    </div>}
  </div>;
}
