/**
 * Quick test: runs QA reviewer against an existing screenshot
 * Usage: npx tsx scripts/test-qa-reviewer.ts [path-to-screenshot]
 */
import { runQAReviewerAgent } from '../lib/ai/agents/qa-reviewer-agent';

const SCREENSHOT =
  process.argv[2] ||
  '/var/folders/0x/t1qhy2ps5vv1r7b52sm0vccc0000gn/T/qa-home-1771868607229-2026-02-23T17-43-45.png';

const spec = {
  visualDirection: 'Warm earthy cozy home feel',
  layoutStyle: 'Centered hero with product grid',
  typographyStyle: 'Clean sans-serif with warm tones',
  colorMood: 'Terracotta and warm beige tones',
  designMood: 'warm' as const,
  sectionsOrder: ['hero', 'featured-categories', 'product-grid', 'newsletter'],
  competitorRefs: ['West Elm', 'Crate and Barrel'],
  brandPersonality: 'Warm and inviting home brand',
  suggestedBrandName: 'Hearthstone',
  industryType: 'home' as const,
};

const brief = {
  brandName: 'Hearthstone',
  industryType: 'home' as const,
  brandTone: 'warm and inviting',
  sections: ['hero', 'featured-categories', 'product-grid', 'newsletter'],
};

async function main() {
  console.log('[test-qa] Using screenshot:', SCREENSHOT);
  console.log('[test-qa] Calling QA reviewer...\n');

  const result = await runQAReviewerAgent(spec, brief, {
    screenshotPath: SCREENSHOT,
    passThreshold: 7,
  });

  console.log('=== QA RESULT ===');
  console.log('Score   :', result.score + '/10');
  console.log('Passed  :', result.passed ? '✓ YES' : '✗ NO');
  console.log('Summary :', result.summary);
  console.log('\nIssues:');
  if (!result.issues?.length) {
    console.log('  (none)');
  } else {
    for (const issue of result.issues) {
      console.log(' -', issue);
    }
  }
}

main().catch(console.error);
