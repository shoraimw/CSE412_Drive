import {readFileSync} from "node:fs";
import {test, before, after} from "node:test";
import {initializeTestEnvironment, assertFails, assertSucceeds} from "@firebase/rules-unit-testing";
import {ref, uploadBytes, getBytes} from "firebase/storage";

let env;
before(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-drive-local",
    storage: {host: "127.0.0.1", port: 9199,
      rules: readFileSync("firebase/storage.rules", "utf8")}
  });
});
after(async () => env.cleanup());
test("Private applicant upload is readable only to applicant and admin", async () => {
  const userStorage = env.authenticatedContext("alice").storage();
  const outsiderStorage = env.authenticatedContext("mallory").storage();
  const adminStorage = env.authenticatedContext("admin1", {admin: true}).storage();
  const path = "applications/alice/licence.jpg";
  const body = new Uint8Array([255, 216, 255, 217]);
  await assertSucceeds(uploadBytes(ref(userStorage, path), body, {contentType: "image/jpeg"}));
  await assertFails(getBytes(ref(outsiderStorage, path)));
  await assertSucceeds(getBytes(ref(adminStorage, path)));
  await assertFails(uploadBytes(ref(userStorage, path), body,
    {contentType: "image/jpeg"})); // immutable KYC evidence
  await assertFails(uploadBytes(ref(outsiderStorage, path), body, {contentType: "image/jpeg"}));
  await assertFails(uploadBytes(ref(userStorage, "applications/alice/payload.exe"),
    new Uint8Array([1, 2]), {contentType: "application/x-msdownload"}));
});
