/**
 * TLS material for the fake SMTP server (tm 255.3).
 *
 * NOT SECRETS. A throwaway EC P-256 hierarchy generated for this repository
 * with `openssl req -x509` / `openssl x509 -req`; the CA's private key was
 * never kept, so nothing here can sign a new certificate. The server keys exist
 * so `test/helpers/fake-smtp-server.ts` can speak real TLS and the carrier's
 * certificate check is exercised against real X.509 rather than a mock — a
 * "refuses an untrusted server" test that never performs a handshake proves
 * nothing (the same argument `certificates.ts` makes for SSO).
 *
 * Validity is pinned to 2025-01-01 → 2125-01-01 so the fixtures cannot change
 * meaning with the calendar.
 */

/** Self-signed test CA, `CN=Nexa SMTP Test CA`. The trust anchor the tests hand the carrier. */
export const SMTP_TEST_CA_PEM = `-----BEGIN CERTIFICATE-----
MIIBoDCCAUWgAwIBAgIUHvOV6Ue/SX5vadeA331jwS+xrukwCgYIKoZIzj0EAwIw
HDEaMBgGA1UEAwwRTmV4YSBTTVRQIFRlc3QgQ0EwIBcNMjUwMTAxMDAwMDAwWhgP
MjEyNTAxMDEwMDAwMDBaMBwxGjAYBgNVBAMMEU5leGEgU01UUCBUZXN0IENBMFkw
EwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEZTVMSVsAjoalypFXq1ZeXY1BxHmwEhT6
EBAu0W5qHH4uie/BuojWuXLb7r49QhpmqEHbAokeFY7FxRkpjk+v16NjMGEwHQYD
VR0OBBYEFOK9mg3W0ZxGFLBnTIau9etcAlibMB8GA1UdIwQYMBaAFOK9mg3W0ZxG
FLBnTIau9etcAlibMA8GA1UdEwEB/wQFMAMBAf8wDgYDVR0PAQH/BAQDAgEGMAoG
CCqGSM49BAMCA0kAMEYCIQCo3NoRTF6Be/+vxr9lRRlpE3MgMA3S8G/qief04Lq1
awIhAKQLYT82uvEpYtg/R6IMmpX3BlfYg8dndWyLtQFKLH5X
-----END CERTIFICATE-----
`;

/** Signed by {@link SMTP_TEST_CA_PEM}; SAN `DNS:localhost, IP:127.0.0.1`. */
export const SMTP_SERVER_CERT_PEM = `-----BEGIN CERTIFICATE-----
MIIBoDCCAUagAwIBAgICEAEwCgYIKoZIzj0EAwIwHDEaMBgGA1UEAwwRTmV4YSBT
TVRQIFRlc3QgQ0EwIBcNMjUwMTAxMDAwMDAwWhgPMjEyNTAxMDEwMDAwMDBaMBQx
EjAQBgNVBAMMCWxvY2FsaG9zdDBZMBMGByqGSM49AgEGCCqGSM49AwEHA0IABJ75
pdsrbihqR1l2JGw1M0XiX8HMyyV9KL1zpgyCmRRnqEjIConX12dAhV1yI2OFVx0T
3i5/JhLF+v7P754yXWKjfjB8MBoGA1UdEQQTMBGCCWxvY2FsaG9zdIcEfwAAATAJ
BgNVHRMEAjAAMBMGA1UdJQQMMAoGCCsGAQUFBwMBMB0GA1UdDgQWBBT9Py7twxgS
j6IrU3nH498opabvEjAfBgNVHSMEGDAWgBTivZoN1tGcRhSwZ0yGrvXrXAJYmzAK
BggqhkjOPQQDAgNIADBFAiAYyePNLvQJJwB6m+mmBLmvLag66j5sBfTMNM5oQPDr
PAIhAL8F/0oL//ar4lOE7sar9Aw7XEcAm5WVM0Wh5Fk0TiIN
-----END CERTIFICATE-----
`;

export const SMTP_SERVER_KEY_PEM = `-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgpPy0kdP+Sfng1h8E
h9lcULwRx7MBxU/7BnCgo2rNyHShRANCAASe+aXbK24oakdZdiRsNTNF4l/BzMsl
fSi9c6YMgpkUZ6hIyAqJ19dnQIVdciNjhVcdE94ufyYSxfr+z++eMl1i
-----END PRIVATE KEY-----
`;

/** Signed by the same CA, but for `DNS:wrong.example.test` only — a hostname mismatch. */
export const SMTP_WRONG_HOST_CERT_PEM = `-----BEGIN CERTIFICATE-----
MIIBrjCCAVOgAwIBAgICEAIwCgYIKoZIzj0EAwIwHDEaMBgGA1UEAwwRTmV4YSBT
TVRQIFRlc3QgQ0EwIBcNMjUwMTAxMDAwMDAwWhgPMjEyNTAxMDEwMDAwMDBaMB0x
GzAZBgNVBAMMEndyb25nLmV4YW1wbGUudGVzdDBZMBMGByqGSM49AgEGCCqGSM49
AwEHA0IABJbOrlFiUmJLSTp+VXdQ0fiQfcEzi8KMlyuDge7lS9TOpn0KhQw/exlp
y2aeV4IjDl6XTeFZJXNkJm/Gz11WbLyjgYEwfzAdBgNVHREEFjAUghJ3cm9uZy5l
eGFtcGxlLnRlc3QwCQYDVR0TBAIwADATBgNVHSUEDDAKBggrBgEFBQcDATAdBgNV
HQ4EFgQUWy32TzsweFwOEVfjTg4PSVo4+uIwHwYDVR0jBBgwFoAU4r2aDdbRnEYU
sGdMhq7161wCWJswCgYIKoZIzj0EAwIDSQAwRgIhALfcCoSW466SlETh/tOCCZrD
pEL4jvbzzQwErP0/F9K1AiEAzv4c256SHuZ2Hms+WoB9FMZPhHJTeplsCSF90BdS
2W0=
-----END CERTIFICATE-----
`;

export const SMTP_WRONG_HOST_KEY_PEM = `-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgsIpNtBI0dM0RJx/e
QIykkIcafrys3fwOeq84M0X5+9ahRANCAASWzq5RYlJiS0k6flV3UNH4kH3BM4vC
jJcrg4Hu5UvUzqZ9CoUMP3sZactmnleCIw5el03hWSVzZCZvxs9dVmy8
-----END PRIVATE KEY-----
`;

/** Self-signed for `localhost` / `127.0.0.1`, chained to nothing the carrier trusts. */
export const SMTP_SELF_SIGNED_CERT_PEM = `-----BEGIN CERTIFICATE-----
MIIBmzCCAUGgAwIBAgIUXHBGffUK+IqJpPBtPL8Xun+w8IYwCgYIKoZIzj0EAwIw
FDESMBAGA1UEAwwJbG9jYWxob3N0MCAXDTI1MDEwMTAwMDAwMFoYDzIxMjUwMTAx
MDAwMDAwWjAUMRIwEAYDVQQDDAlsb2NhbGhvc3QwWTATBgcqhkjOPQIBBggqhkjO
PQMBBwNCAASScD559BgIvdE1luZRpBh1udMMU+cQq5BWfw7PyifAMp61Fo2W/q89
KjGbp+KHhRwwkmmdxLBdVU8bLuDJOQeoo28wbTAdBgNVHQ4EFgQU7ZAWK98rCReJ
EUZJHkSFWfcgQCIwHwYDVR0jBBgwFoAU7ZAWK98rCReJEUZJHkSFWfcgQCIwDwYD
VR0TAQH/BAUwAwEB/zAaBgNVHREEEzARgglsb2NhbGhvc3SHBH8AAAEwCgYIKoZI
zj0EAwIDSAAwRQIhAIt3OFNQkeRybAEyBTBIWrvRmLFmhSroPO7peYb5bgLVAiBc
0rlzPb6euLkyJyBQznjeOaD5MVojH8/UZOw3Q8HiOw==
-----END CERTIFICATE-----
`;

export const SMTP_SELF_SIGNED_KEY_PEM = `-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgffskxYBcLdIMr5oC
CTgviADjImJ5siUjljjRP103M7+hRANCAASScD559BgIvdE1luZRpBh1udMMU+cQ
q5BWfw7PyifAMp61Fo2W/q89KjGbp+KHhRwwkmmdxLBdVU8bLuDJOQeo
-----END PRIVATE KEY-----
`;
