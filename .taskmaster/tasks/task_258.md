# Task ID: 258

**Title:** CI-GREEN [OPUS-HIGH] GitHub Actions main'i yeşile çevir

**Status:** done

**Dependencies:** None

**Priority:** high

**Description:** ci.yml: birim test adımı turbo'yu PATH'te bulamıyor (exit 127); entegrasyon seri ~22 dk 20 dk iş sınırına sığmıyor; e2e sınırı 25 dk dar; pilot imajları CI'de derlenmiyor (257.12 OOM boşluğu).

**Details:**

Yalnız .github/workflows/ci.yml: pnpm turbo; integration ayrı iş, 3 parçalı matris (with-test-datastores vitest --shard=i/3), rtm parça 1'de; e2e timeout 45; pilot-images işi (.env.production.example ile docker compose -f docker-compose.pilot.yml build). Doğrulama: fix/ci-pipeline dalında workflow_dispatch ile tüm işler yeşil, sonra main.

[günlük 2026-10-04 18:21 UTC] plan: yalnız ci.yml — pnpm turbo; integration ayrı iş 3 parça matris; e2e timeout 45; pilot-images build işi; fix/ci-pipeline dalında workflow_dispatch ile doğrula

[günlük 2026-10-04 19:21 UTC] doğrulama: CI 37225749905 yedi iş yeşil; kök nedenler: çıplak turbo + eksik UPLOAD_SIGNING_KEY

**Test Strategy:**

No test strategy provided.
