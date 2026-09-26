import { describe, expect, it } from 'vitest';
import { classifyByUrl } from './sourceClass.js';

describe('classifyByUrl', () => {
  it('classifies liander.nl pages as grid_update', () => {
    expect(classifyByUrl('https://www.liander.nl/nieuws/capaciteit')).toBe('grid_update');
    expect(classifyByUrl('https://liander.nl/')).toBe('grid_update');
  });

  it('classifies enexis.nl pages as grid_update', () => {
    expect(classifyByUrl('https://www.enexis.nl/netcapaciteit/afname')).toBe('grid_update');
  });

  it('classifies stedin.net pages as grid_update', () => {
    expect(classifyByUrl('https://www.stedin.net/zakelijk/capaciteit')).toBe('grid_update');
  });

  it('classifies subdomains of grid operators as grid_update', () => {
    expect(classifyByUrl('https://capaciteit.liander.nl/regio/nh')).toBe('grid_update');
    expect(classifyByUrl('https://transportkaart.enexis.nl/')).toBe('grid_update');
  });

  it('classifies company / newsroom pages as business_signal', () => {
    expect(
      classifyByUrl(
        'https://newsroom.postnl.nl/en-NL/259192-postnl-aims-to-develop-charging-hubs-for-truck-transport/',
      ),
    ).toBe('business_signal');
    expect(classifyByUrl('https://vanrijn-logistics.example/nieuws/elektrische-vloot-2026')).toBe(
      'business_signal',
    );
  });

  it('defaults unknown / malformed URLs to business_signal (safe default)', () => {
    expect(classifyByUrl('not-a-url')).toBe('business_signal');
    expect(classifyByUrl('')).toBe('business_signal');
    expect(classifyByUrl('https://example.com/')).toBe('business_signal');
  });

  it('is case-insensitive on the host', () => {
    expect(classifyByUrl('https://LIANDER.NL/foo')).toBe('grid_update');
    expect(classifyByUrl('https://Enexis.NL/bar')).toBe('grid_update');
  });

  it('does not misclassify look-alike hosts', () => {
    // Substring "liander" in a host that is NOT liander.nl → business_signal
    expect(classifyByUrl('https://not-liander.nl.example.com/')).toBe('business_signal');
    expect(classifyByUrl('https://enexis-fanpage.example/')).toBe('business_signal');
  });
});
