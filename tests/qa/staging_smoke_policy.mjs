import {validateStaging} from "./staging_policy.mjs";

/** Only address the team-configured Firebase Hosting staging site.
 * No user-supplied arbitrary URL, redirects or localhost requests.
 */
export function stagingAdminUrl(projectId, siteId, confirmation, approval) {
  const issues=validateStaging(projectId,siteId,confirmation,approval);
  if(issues.length) throw new Error("Refusing non-staging destination: "+issues.join(" "));
  return new URL("https://"+siteId+".web.app/");
}

export function validateStagingAdminResponse(status, headers, html) {
  const errors=[];
  if(status!==200) errors.push("Admin Hosting did not return HTTP 200.");
  if(!String(headers.get("content-type")||"").toLowerCase().includes("text/html"))
    errors.push("Admin Hosting did not return an HTML document.");
  if(!/<div\s+id=["']root["']\s*>/i.test(html))
    errors.push("Admin React mount point was not served.");
  if(headers.get("x-content-type-options")?.toLowerCase()!=="nosniff")
    errors.push("Missing nosniff response header.");
  if(headers.get("x-frame-options")?.toUpperCase()!=="DENY")
    errors.push("Missing DENY framing header.");
  if(headers.get("referrer-policy")?.toLowerCase()!=="no-referrer")
    errors.push("Missing no-referrer policy header.");
  if(!headers.get("content-security-policy-report-only"))
    errors.push("Missing report-only CSP header.");
  return errors;
}
