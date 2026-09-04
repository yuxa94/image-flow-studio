import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const html = readFileSync(
  new URL('../education-30hours-image-flow-studio.html', import.meta.url),
  'utf8',
);

test('발표자료는 정확히 10장의 슬라이드로 구성된다', () => {
  const slides = html.match(/<section\b[^>]*class="[^"]*\bslide\b[^"]*"/g) ?? [];
  assert.equal(slides.length, 10);
});

test('불필요한 바이브 코딩 정의 대신 프로젝트 제작기를 다룬다', () => {
  assert.doesNotMatch(html, /<h2[^>]*>\s*바이브 코딩이란/);
  assert.match(html, /Image Flow Studio 제작기/);
  assert.match(html, /21개 커밋/);
});

test('모든 커밋 해시가 교육용 타임라인에 포함된다', () => {
  const hashes = [
    '25988e1', '1c57b86', 'a8c72e6', '59332b6', '2c8cf78',
    '02c367d', '879e3bb', '9f0e8b6', 'ae32012', '1467480',
    '8105fb5', 'c0ffb45', 'b20a895', 'ef675a9', 'efa580f',
    'ec59f02', '88a42f6', '5e41c92', 'dd2b808', 'ecce14f',
    '37cbd1a',
  ];

  for (const hash of hashes) assert.match(html, new RegExp(hash));
});

test('초보자를 위한 용어 설명과 발표 조작 요소가 있다', () => {
  assert.match(html, /커밋.*저장/);
  assert.match(html, /aria-label="다음 슬라이드"/);
  assert.match(html, /ArrowRight/);
  assert.match(html, /touchstart/);
  assert.match(html, /prefers-reduced-motion/);
});
