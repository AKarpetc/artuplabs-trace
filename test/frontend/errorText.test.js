import { describe, it, expect } from 'vitest';
import { errorText } from '../../src/frontend/errorText';

describe('errorText', () => {
  it('maps resolver reasons to friendly texts', () => {
    expect(errorText(new Error('no-permission'))).toBe('You do not have permission for this action in this project.');
    expect(errorText(new Error('unlicensed'))).toBe('ArtUp Trace license is not active on this site.');
    expect(errorText(new Error('bad-request'))).toBe('The request was not valid. Reload the page and try again.');
  });

  it('passes other messages through', () => {
    expect(errorText('Jira request failed (500)')).toBe('Jira request failed (500)');
  });
});
