# Changelog

## [0.4.0](https://github.com/Sukooo/ranzen/compare/v0.3.0...v0.4.0) (2026-10-28)


### ⚠ BREAKING CHANGES

* `Substitution.periodNumbers` and `Day.rotation` are new required fields. Code that builds these objects itself (fixtures, mocks) must add them.

### Features

* add Kurswahl Online client and SPH rotation/period numbers ([#4](https://github.com/Sukooo/ranzen/issues/4)) ([d1d2e82](https://github.com/Sukooo/ranzen/commit/d1d2e825e50fed86573da442513d4f92bd4538dc))

## [0.3.0](https://github.com/Sukooo/ranzen/compare/v0.2.1...v0.3.0) (2026-10-18)


### ⚠ BREAKING CHANGES

* **lessons:** Periods.from and Periods.to can be null.

### Bug Fixes

* **lessons:** keep key text as written and fail on unknown course cards ([#2](https://github.com/Sukooo/ranzen/issues/2)) ([b64d804](https://github.com/Sukooo/ranzen/commit/b64d804bd0e489452631d8059b3adbc46c7f7658))

## [0.2.1](https://github.com/Sukooo/ranzen/compare/v0.2.0...v0.2.1) (2026-10-18)


### Miscellaneous Chores

* release 0.2.1 ([4f3609a](https://github.com/Sukooo/ranzen/commit/4f3609a2edc2b57b6b0b33e6abb49ad94b972f3c))
