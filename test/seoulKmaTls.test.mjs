import assert from "node:assert/strict";
import { X509Certificate } from "node:crypto";
import { rootCertificates } from "node:tls";
import test from "node:test";

import {
  buildKmaTlsCertificateAuthorities,
  DIGICERT_GLOBAL_ROOT_G2_SHA256,
  RAPIDSSL_TLS_RSA_CA_G1_PEM,
  RAPIDSSL_TLS_RSA_CA_G1_SHA256,
} from "../convex/seoulKmaTls.js";

test("bundles only the verified RapidSSL intermediate after Node's roots", () => {
  const certificateAuthorities = buildKmaTlsCertificateAuthorities();
  assert.equal(certificateAuthorities.length, rootCertificates.length + 1);
  assert.deepEqual(
    certificateAuthorities.slice(0, rootCertificates.length),
    rootCertificates,
  );
  assert.equal(
    certificateAuthorities.at(-1),
    RAPIDSSL_TLS_RSA_CA_G1_PEM,
  );
});

test("RapidSSL intermediate chains to Node's trusted DigiCert root", () => {
  const intermediate = new X509Certificate(RAPIDSSL_TLS_RSA_CA_G1_PEM);
  const rootPem = rootCertificates.find(
    (pem) =>
      new X509Certificate(pem).fingerprint256 ===
      DIGICERT_GLOBAL_ROOT_G2_SHA256,
  );

  assert.ok(rootPem, "DigiCert Global Root G2 should be trusted by Node");
  assert.equal(intermediate.fingerprint256, RAPIDSSL_TLS_RSA_CA_G1_SHA256);
  assert.equal(intermediate.ca, true);
  assert.equal(intermediate.verify(new X509Certificate(rootPem).publicKey), true);
});
