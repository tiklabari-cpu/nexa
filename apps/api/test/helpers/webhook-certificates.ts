/**
 * TLS material for a local HTTPS webhook receiver (tm 256.9).
 *
 * NOT SECRETS. A throwaway EC P-256 pair generated for this repository with
 * `openssl req -x509` / `openssl x509 -req`; the CA's private key was never
 * kept, so nothing here can sign a new certificate. The receiver key exists so
 * `webhook-sender.test.ts` can run a real TLS handshake against the pinned
 * connection: that SNI and the certificate check follow the registered name
 * rather than the address the connection was pinned to is only proven by a
 * handshake that actually happens (the argument `smtp-certificates.ts` makes
 * for the mail carrier).
 *
 * `hooks.example.test` is deliberately a name no resolver can answer (`.test`
 * is reserved, RFC 6761), so a request that reaches a receiver under it went
 * to the pinned address and not through DNS.
 *
 * Validity is pinned to 2025-01-01 → 2125-01-01 so the fixtures cannot change
 * meaning with the calendar.
 */

/** Self-signed test CA, `CN=SiyahTus Webhook Test CA`: the trust anchor handed to the sender. */
export const WEBHOOK_TEST_CA_PEM = `-----BEGIN CERTIFICATE-----
MIIBrTCCAVOgAwIBAgIUb6YUl9Xakw54bQhX2K25nIM/U6AwCgYIKoZIzj0EAwIw
IzEhMB8GA1UEAwwYU2l5YWhUdXMgV2ViaG9vayBUZXN0IENBMCAXDTI1MDEwMTAw
MDAwMFoYDzIxMjUwMTAxMDAwMDAwWjAjMSEwHwYDVQQDDBhTaXlhaFR1cyBXZWJo
b29rIFRlc3QgQ0EwWTATBgcqhkjOPQIBBggqhkjOPQMBBwNCAATe7nsGmtA2Aw6N
GSUvs4597gVGeSRkQ0OTOgUksByoeRO0fR2FGVLNvOf7LBCyefCZ0SvR0JX0Yq2j
u3MLU1Ayo2MwYTAdBgNVHQ4EFgQU8t7YJ8mecFE5toCsORyy/wLzAYkwHwYDVR0j
BBgwFoAU8t7YJ8mecFE5toCsORyy/wLzAYkwDwYDVR0TAQH/BAUwAwEB/zAOBgNV
HQ8BAf8EBAMCAQYwCgYIKoZIzj0EAwIDSAAwRQIhAPG2rNEnPqE9XlheeO/xH6fH
/YWQ8CB5oGLQFEQxqUibAiAuVWigDiVkJERLWmeDTU8eTGUISEjnJTbXB1U0zDuZ
Iw==
-----END CERTIFICATE-----
`;

/** Signed by {@link WEBHOOK_TEST_CA_PEM}; SAN `DNS:hooks.example.test` only, EKU serverAuth. */
export const WEBHOOK_RECEIVER_CERT_PEM = `-----BEGIN CERTIFICATE-----
MIIBtDCCAVqgAwIBAgICEAEwCgYIKoZIzj0EAwIwIzEhMB8GA1UEAwwYU2l5YWhU
dXMgV2ViaG9vayBUZXN0IENBMCAXDTI1MDEwMTAwMDAwMFoYDzIxMjUwMTAxMDAw
MDAwWjAdMRswGQYDVQQDDBJob29rcy5leGFtcGxlLnRlc3QwWTATBgcqhkjOPQIB
BggqhkjOPQMBBwNCAARAqdaZIclA5c7d4y5mpzYpgpt4LbK6VSwquIbFCAg62uUM
UHNa6F+8eR+gqdz/GfgbKf8jyz5k9EnzLDz/a6eKo4GBMH8wHQYDVR0RBBYwFIIS
aG9va3MuZXhhbXBsZS50ZXN0MAkGA1UdEwQCMAAwEwYDVR0lBAwwCgYIKwYBBQUH
AwEwHQYDVR0OBBYEFINrhcmXgLKaBkWAOFcvrXzPZo/YMB8GA1UdIwQYMBaAFPLe
2CfJnnBRObaArDkcsv8C8wGJMAoGCCqGSM49BAMCA0gAMEUCIQC7CwbZaBzwl7aO
ePr0g8ZD9ZbhWM+gQVhFFST1cYiYXAIgfZOsDUmj4f8CpUEhZknBNFLqHJo5/GFk
BFF7cNXTgDQ=
-----END CERTIFICATE-----
`;

export const WEBHOOK_RECEIVER_KEY_PEM = `-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgJyJiLy+epS+41VhR
BlJpCXGRPCS065dWpwOriAaozsqhRANCAARAqdaZIclA5c7d4y5mpzYpgpt4LbK6
VSwquIbFCAg62uUMUHNa6F+8eR+gqdz/GfgbKf8jyz5k9EnzLDz/a6eK
-----END PRIVATE KEY-----
`;
