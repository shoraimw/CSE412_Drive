/**
 * A deliberate safety boundary: a manually approved staging-only deploy.
 * Never use this module to validate a production release.
 */
export function validateStaging(projectId, siteId, confirmation, approved) {
  const slug = /^[a-z][a-z0-9-]{5,49}$/;
  const isStage = value => /(^|-)(staging|stg)(-|$)/.test(value);
  const safe = value => slug.test(value) && isStage(value) &&
    !/(^|-)(prod|production|live|demo)(-|$)/.test(value);
  const errors = [];
  if (confirmation !== "STAGING ONLY") errors.push("Explicit staging confirmation required.");
  if (approved !== "true") errors.push("Staging deployment approval variable is missing.");
  if (!safe(projectId || "")) errors.push("Project ID must identify an isolated staging project.");
  if (!safe(siteId || "")) errors.push("Hosting site must identify an isolated staging site.");
  return errors;
}
