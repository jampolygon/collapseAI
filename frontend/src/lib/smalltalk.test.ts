import { describe, expect, it } from 'vitest';
import { isLocationQuestion, smallTalkReply } from './smalltalk';

describe('smallTalkReply', () => {
  it('answers greetings in English and Tagalog, with or without "po"', () => {
    for (const m of ['hello', 'Hi!', 'hello po', 'Good morning', 'kumusta po', 'magandang umaga po', 'hey there']) {
      expect(smallTalkReply(m), m).toMatch(/CollapseAI/);
    }
  });
  it('answers thanks, goodbye and identity questions', () => {
    expect(smallTalkReply('thank you so much')).toMatch(/welcome/i);
    expect(smallTalkReply('salamat po')).toMatch(/welcome/i);
    expect(smallTalkReply('bye')).toMatch(/care/i);
    expect(smallTalkReply('who are you?')).toMatch(/offline|device/i);
    expect(smallTalkReply('how are you')).not.toBeNull();
  });
  it('lets real questions through, even when they start with a greeting word', () => {
    for (const m of ['hello how do I stop bleeding', 'hi, my child has a fever', 'how to purify water', 'paano gamutin ang sugat', 'thanks, what about kids?']) {
      expect(smallTalkReply(m), m).toBeNull();
    }
  });
  it('ignores empty input', () => {
    expect(smallTalkReply('   ')).toBeNull();
    expect(smallTalkReply('🙂')).toBeNull();
  });
});

describe('location questions', () => {
  it('points "nearest X" questions to Map / Compass', () => {
    for (const q of ['nearest hospital', 'where is the closest evacuation center', 'pinakamalapit na ospital', 'clinic near me']) {
      expect(isLocationQuestion(q), q).toBe(true);
      expect(smallTalkReply(q), q).toMatch(/Map/);
    }
  });
  it('does not hijack real survival questions that mention nearness', () => {
    for (const q of ['lightning nearby what do I do', 'malapit na ang bagyo ano gagawin', 'how near is the typhoon']) {
      expect(isLocationQuestion(q), q).toBe(false);
    }
  });
});
