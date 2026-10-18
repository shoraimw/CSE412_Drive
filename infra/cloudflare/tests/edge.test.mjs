import {test} from "node:test";
import assert from "node:assert/strict";
import edge from "../src/index.js";

const gate = (success=true) => ({limit:async()=>({success})});
const env = (ipOk=true,userOk=true) => ({
  PUBLIC_IP_LIMIT:gate(ipOk),USER_LIMIT:gate(userOk),
  DRIVE_ORIGIN_URL:"https://staging-api.example.org",
  DRIVE_ORIGIN_AUTH:"test-edge-secret",
});
const request = (path="/api/v1/public/demo",opts={})=>new Request(
  "https://api.example.org"+path,{
    headers:{
      "cf-connecting-ip":"198.51.100.8",
      authorization:"Bearer testing-firebase-token",
      "x-firebase-appcheck":"testing-appcheck-token",
      ...opts.headers,
    },
    method:opts.method||"GET",body:opts.body,
  }
);
test("edge health is minimal and unknown routes are denied",async()=>{
  const h=await edge.fetch(request("/healthz"),env());
  assert.equal(h.status,200);
  const r=await edge.fetch(request("/private"),env());
  assert.equal(r.status,404);
});
test("IP rate limiting rejects before origin access",async()=>{
  const r=await edge.fetch(request(),env(false,true));
  assert.equal(r.status,429);
  assert.equal(r.headers.get("retry-after"),"60");
});
test("missing auth/appcheck is refused",async()=>{
  const r=await edge.fetch(request("/api/v1/abc",{headers:{"authorization":""}}),env());
  assert.equal(r.status,401);
});
test("token rate limiting denies excess",async()=>{
  const r=await edge.fetch(request(),env(true,false));
  assert.equal(r.status,429);
});
test("large request and insecure origin are rejected",async()=>{
  const oversized=await edge.fetch(request("/api/v1/abc",{
    method:"POST",body:"{}",headers:{"content-length":"17000"}
  }),env());
  assert.equal(oversized.status,413);
  const wrongOrigin=await edge.fetch(request(),{
    ...env(),DRIVE_ORIGIN_URL:"http://unsafe.example.org"
  });
  assert.equal(wrongOrigin.status,503);
});
test("upstream redirect does not leak to client",async()=>{
  const original=globalThis.fetch;
  try{
    globalThis.fetch=async()=>new Response(null,{
      status:302,headers:{location:"https://attacker.example/"}
    });
    const r=await edge.fetch(request(),env());
    assert.equal(r.status,502);
  }finally{globalThis.fetch=original;}
});
