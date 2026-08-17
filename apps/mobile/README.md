# Nexa Mobile

The agent phone app (Expo / React Native): Inbox, Customers, Reports, AI/Copilot,
Settings — plus push. See the root [README](../../README.md) for the rest of the
platform and [PLAN.md](../../PLAN.md) §13.7 for what is and isn't built yet.

## Prerequisites

- Node 24, pnpm 11 (same as the rest of the monorepo).
- The API + RTM running — from the repo root: `make dev`.
- A way to run the app: [Expo Go](https://expo.dev/go) on a physical device or
  simulator/emulator, or a custom dev build. No EAS account, Apple/Google
  developer account, or app-store step is needed for local development
  (store submission is out of scope for this repo — PLAN.md §D110).

## Running it

From the repo root, once `make dev` is up:

```bash
pnpm --filter @nexa/mobile start
```

This runs `expo start` and prints a QR code / dev-menu options for
simulator, emulator, or a physical device via Expo Go. Platform-specific
shortcuts:

```bash
pnpm --filter @nexa/mobile android   # expo start --android
pnpm --filter @nexa/mobile ios       # expo start --ios
```

> There is no `pnpm --filter @nexa/mobile dev` — `apps/mobile` deliberately
> does not define a `dev` script. Turborepo's `dev` pipeline runs every
> workspace's `dev` script together; Expo's `start` is an interactive,
> long-running dev-server process that would sit inside `make dev` and block
> the rest of the stack from finishing its own startup. Run `start` (or
> `android`/`ios`) yourself, in a separate terminal, after `make dev`.

## Pointing the app at the API

`app.config.ts` sets `expo.extra.apiBaseUrl` / `expo.extra.rtmBaseUrl`, read at
runtime by `src/config.ts`. The defaults are the root README's port table
(`http://localhost:4000/api/v1`, `ws://localhost:4001`), which is only reachable
as-is from certain targets:

| Target                    | `localhost` resolves to           | What to do                                                                                                                                                                                                            |
| ------------------------- | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| iOS Simulator             | the host Mac                      | Defaults work as-is.                                                                                                                                                                                                  |
| Android Emulator          | the emulator itself, not the host | Defaults won't reach the host. Use `10.0.2.2` (the emulator's alias for the host loopback): `NEXA_API_BASE_URL="http://10.0.2.2:4000/api/v1" NEXA_RTM_BASE_URL="ws://10.0.2.2:4001" pnpm --filter @nexa/mobile start` |
| Physical device (Expo Go) | the device itself                 | Use your dev machine's LAN IP, reachable from the device's Wi-Fi: `NEXA_API_BASE_URL="http://<lan-ip>:4000/api/v1" NEXA_RTM_BASE_URL="ws://<lan-ip>:4001" pnpm --filter @nexa/mobile start`                           |

A misconfigured or missing value doesn't degrade quietly — `readMobileConfig`
throws, and `App.tsx` shows a `ConfigErrorScreen` naming the problem instead of
a blank screen.

## Signing in

`make dev` seeds two demo tenants (`apps/api/prisma/seed.ts`). Use the first
tenant's owner account:

- Email: `owner@acme.localhost`
- Password: `nexa-demo-password`

(`apps/api/prisma/seed.ts:25` defines the shared demo password; `:328` creates
this account under the `acme` tenant.)

## Push notifications

Push is mocked end to end — there is no APNs/FCM traffic and no EAS project.
The mock provider writes to `.data/push/<licenseId>/` on the API host instead
of calling a real push service (see PLAN.md K13.7, `13.7-d`). Registering a
device still exercises the real `/notifications/devices` endpoints; only the
final delivery hop is stubbed.

## Commands

```bash
pnpm --filter @nexa/mobile test        # jest (jest-expo + React Native Testing Library)
pnpm --filter @nexa/mobile typecheck   # tsc --noEmit
pnpm --filter @nexa/mobile lint        # eslint
pnpm --filter @nexa/mobile build       # expo export (ios + android), no device/simulator needed
```

These also run from the repo root as `pnpm -w test` / `typecheck` / `lint` /
`build` alongside every other workspace.
