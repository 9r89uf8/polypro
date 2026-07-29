"use node";

import { X509Certificate } from "node:crypto";
import { rootCertificates } from "node:tls";

// KMA's AMO server currently omits this intermediate from its TLS handshake.
// This exact certificate is published by DigiCert at:
// https://cacerts.digicert.com/RapidSSLTLSRSACAG1.crt.pem
export const RAPIDSSL_TLS_RSA_CA_G1_PEM = `-----BEGIN CERTIFICATE-----
MIIEszCCA5ugAwIBAgIQCyWUIs7ZgSoVoE6ZUooO+jANBgkqhkiG9w0BAQsFADBh
MQswCQYDVQQGEwJVUzEVMBMGA1UEChMMRGlnaUNlcnQgSW5jMRkwFwYDVQQLExB3
d3cuZGlnaWNlcnQuY29tMSAwHgYDVQQDExdEaWdpQ2VydCBHbG9iYWwgUm9vdCBH
MjAeFw0xNzExMDIxMjI0MzNaFw0yNzExMDIxMjI0MzNaMGAxCzAJBgNVBAYTAlVT
MRUwEwYDVQQKEwxEaWdpQ2VydCBJbmMxGTAXBgNVBAsTEHd3dy5kaWdpY2VydC5j
b20xHzAdBgNVBAMTFlJhcGlkU1NMIFRMUyBSU0EgQ0EgRzEwggEiMA0GCSqGSIb3
DQEBAQUAA4IBDwAwggEKAoIBAQC/uVklRBI1FuJdUEkFCuDL/I3aJQiaZ6aibRHj
ap/ap9zy1aYNrphe7YcaNwMoPsZvXDR+hNJOo9gbgOYVTPq8gXc84I75YKOHiVA4
NrJJQZ6p2sJQyqx60HkEIjzIN+1LQLfXTlpuznToOa1hyTD0yyitFyOYwURM+/CI
8FNFMpBhw22hpeAQkOOLmsqT5QZJYeik7qlvn8gfD+XdDnk3kkuuu0eG+vuyrSGr
5uX5LRhFWlv1zFQDch/EKmd163m6z/ycx/qLa9zyvILc7cQpb+k7TLra9WE17YPS
n9ANjG+ECo9PDW3N9lwhKQCNvw1gGoguyCQu7HE7BnW8eSSFAgMBAAGjggFmMIIB
YjAdBgNVHQ4EFgQUDNtsgkkPSmcKuBTuesRIUojrVjgwHwYDVR0jBBgwFoAUTiJU
IBiV5uNu5g/6+rkS7QYXjzkwDgYDVR0PAQH/BAQDAgGGMB0GA1UdJQQWMBQGCCsG
AQUFBwMBBggrBgEFBQcDAjASBgNVHRMBAf8ECDAGAQH/AgEAMDQGCCsGAQUFBwEB
BCgwJjAkBggrBgEFBQcwAYYYaHR0cDovL29jc3AuZGlnaWNlcnQuY29tMEIGA1Ud
HwQ7MDkwN6A1oDOGMWh0dHA6Ly9jcmwzLmRpZ2ljZXJ0LmNvbS9EaWdpQ2VydEds
b2JhbFJvb3RHMi5jcmwwYwYDVR0gBFwwWjA3BglghkgBhv1sAQEwKjAoBggrBgEF
BQcCARYcaHR0cHM6Ly93d3cuZGlnaWNlcnQuY29tL0NQUzALBglghkgBhv1sAQIw
CAYGZ4EMAQIBMAgGBmeBDAECAjANBgkqhkiG9w0BAQsFAAOCAQEAGUSlOb4K3Wtm
SlbmE50UYBHXM0SKXPqHMzk6XQUpCheF/4qU8aOhajsyRQFDV1ih/uPIg7YHRtFi
CTq4G+zb43X1T77nJgSOI9pq/TqCwtukZ7u9VLL3JAq3Wdy2moKLvvC8tVmRzkAe
0xQCkRKIjbBG80MSyDX/R4uYgj6ZiNT/Zg6GI6RofgqgpDdssLc0XIRQEotxIZcK
zP3pGJ9FCbMHmMLLyuBd+uCWvVcF2ogYAawufChS/PT61D9rqzPRS5I2uqa3tmIT
44JhJgWhBnFMb7AGQkvNq9KNS9dd3GWc17H/dXa1enoxzWjE0hBdFjxPhUb0W3wi
8o34/m8Fxw==
-----END CERTIFICATE-----`;

export const RAPIDSSL_TLS_RSA_CA_G1_SHA256 =
  "44:22:E9:63:EE:53:CD:58:CC:9F:85:CD:40:BF:5F:FE:C0:09:5F:DF:1A:15:45:35:66:1C:1C:06:BC:AD:C6:9B";
export const DIGICERT_GLOBAL_ROOT_G2_SHA256 =
  "CB:3C:CB:B7:60:31:E5:E0:13:8F:8D:D3:9A:23:F9:DE:47:FF:C3:5E:43:C1:14:4C:EA:27:D4:6A:5A:B1:CB:5F";

export function buildKmaTlsCertificateAuthorities() {
  const intermediate = new X509Certificate(RAPIDSSL_TLS_RSA_CA_G1_PEM);
  if (
    intermediate.fingerprint256 !== RAPIDSSL_TLS_RSA_CA_G1_SHA256 ||
    !intermediate.ca ||
    !intermediate.subject.includes("CN=RapidSSL TLS RSA CA G1") ||
    !intermediate.issuer.includes("CN=DigiCert Global Root G2")
  ) {
    throw new Error("The bundled KMA TLS intermediate failed validation.");
  }

  const trustedRootPem = rootCertificates.find((pem) => {
    const certificate = new X509Certificate(pem);
    return certificate.fingerprint256 === DIGICERT_GLOBAL_ROOT_G2_SHA256;
  });
  if (!trustedRootPem) {
    throw new Error("DigiCert Global Root G2 is missing from the Node trust store.");
  }
  const trustedRoot = new X509Certificate(trustedRootPem);
  if (!intermediate.verify(trustedRoot.publicKey)) {
    throw new Error(
      "The bundled KMA TLS intermediate is not signed by the trusted DigiCert root.",
    );
  }

  // Supplying `ca` replaces Node's defaults, so retain every normal trusted
  // root and append only the verified missing intermediate.
  return [...rootCertificates, RAPIDSSL_TLS_RSA_CA_G1_PEM];
}
