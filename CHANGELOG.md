# Changelog

All notable changes to Octave are written down here, for the person using it
rather than the person building it. The format is [Keep a Changelog](https://keepachangelog.com/en/2.0.0/);
the versions follow [SemVer](https://semver.org/), and while they begin with 0 anything may change.

## [Unreleased]

### Changed
- The app is called Octave. The agent at the table is still pi.
- Octave's own settings and log moved from `~/.pi/web-ui/` to `~/.octave/`. What pi keeps — credentials, sessions — stays under `~/.pi/`.
- A fresh install opens pi on Coding — reading, searching and editing files, but no shell. Full access is one step up in the tool menu, and is remembered once chosen.
- Extensions installed in your own pi (`~/.pi/agent`) are no longer loaded into Octave's sessions; pi's built-in tools and Octave's own are what pi has here.

### Added
- Octave ships as a signed, notarized disk image for Apple Silicon Macs: download, open, drag to Applications, no warnings.
- The licence (AGPL-3.0) and the notices of everything the app is built on ship inside it.

[Unreleased]: https://github.com/minkyojung/pi-web-ui/compare/reader-v1...HEAD
