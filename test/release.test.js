import assert from "node:assert/strict";
import test from "node:test";

import { REPO, cut, sectionFor, unreleased } from "../scripts/release.mjs";

const HEAD = "# Changelog\n\nWords about the format.\n\n";

test("Unreleased는 제목과 다음 절 사이의 글이고, 비어 있으면 빈 문자열", () => {
	assert.equal(unreleased(`${HEAD}## [Unreleased]\n\n### Added\n- a thing\n\n[Unreleased]: x\n`), "### Added\n- a thing");
	assert.equal(unreleased(`${HEAD}## [Unreleased]\n\n## [0.0.1] - 2026-09-20\n### Added\n- old\n`), "");
	assert.equal(unreleased(`${HEAD}## [Unreleased]\n\n[Unreleased]: x\n`), "");
});

test("첫 릴리스: Unreleased가 버전 절이 되고, 빈 Unreleased가 위에, 링크는 태그로", () => {
	const before = `${HEAD}## [Unreleased]\n\n### Added\n- a thing\n\n[Unreleased]: ${REPO}/compare/reader-v1...HEAD\n`;
	const after = cut(before, "0.0.1", "2026-09-20", null);
	assert.equal(
		after,
		`${HEAD}## [Unreleased]\n\n## [0.0.1] - 2026-09-20\n\n### Added\n- a thing\n\n[Unreleased]: ${REPO}/compare/v0.0.1...HEAD\n[0.0.1]: ${REPO}/releases/tag/v0.0.1\n`,
	);
	assert.equal(unreleased(after), "");
	assert.equal(sectionFor(after, "0.0.1"), "### Added\n- a thing");
});

test("다음 릴리스: 이전 태그와 비교하는 링크가 옛 링크들 위에 들어간다", () => {
	const first = cut(`${HEAD}## [Unreleased]\n\n- one\n\n[Unreleased]: x\n`, "0.0.1", "2026-09-20", null);
	const withNew = first.replace("## [Unreleased]\n", "## [Unreleased]\n\n### Fixed\n- two\n");
	const second = cut(withNew, "0.0.2", "2026-10-01", "v0.0.1");
	assert.match(second, /## \[Unreleased\]\n\n## \[0\.0\.2\] - 2026-10-01\n\n### Fixed\n- two\n\n## \[0\.0\.1\] - 2026-09-20\n/);
	assert.ok(second.endsWith(`[Unreleased]: ${REPO}/compare/v0.0.2...HEAD\n[0.0.2]: ${REPO}/compare/v0.0.1...v0.0.2\n[0.0.1]: ${REPO}/releases/tag/v0.0.1\n`), second.slice(-200));
	assert.equal(sectionFor(second, "0.0.1"), "- one");
	assert.equal(sectionFor(second, "0.0.3"), null);
});
