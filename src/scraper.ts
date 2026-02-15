/**
 * Core scraping logic for Meta Ads Library
 * AGGRESSIVE MODE - Optimized for speed
 */

import { Page } from 'playwright';
import { MetaAd, SearchQuery } from './types.js';
import { log } from 'crawlee';

const AD_LIBRARY_BASE = 'https://www.facebook.com/ads/library/';

/**
 * Generate a unique fingerprint for an ad
 */
export function generateAdFingerprint(ad: Partial<MetaAd>): string {
  const components = [
    ad.page_id || '',
    ad.page_name || '',
    (ad.ad_text || '').toLowerCase().replace(/\s+/g, ' ').trim().substring(0, 200),
    (ad.media_urls?.[0] || '').split('?')[0],
    (ad.cta_text || '').toLowerCase(),
  ].join('|');
  
  let hash = 0;
  for (let i = 0; i < components.length; i++) {
    const char = components.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  
  return `meta_${Math.abs(hash).toString(16).padStart(8, '0')}`;
}

/**
 * Deduplicate ads by fingerprint
 */
export function deduplicateAds(ads: MetaAd[]): MetaAd[] {
  const seen = new Set<string>();
  const unique: MetaAd[] = [];
  
  for (const ad of ads) {
    if (!ad.ad_fingerprint) {
      ad.ad_fingerprint = generateAdFingerprint(ad);
    }
    
    if (!seen.has(ad.ad_fingerprint)) {
      seen.add(ad.ad_fingerprint);
      unique.push(ad);
    }
  }
  
  return unique;
}

/**
 * Deduplication tracker for use during scraping
 */
export class DeduplicationTracker {
  private seen = new Set<string>();
  private duplicateCount = 0;
  
  isNew(ad: MetaAd): boolean {
    if (!ad.ad_fingerprint) {
      ad.ad_fingerprint = generateAdFingerprint(ad);
    }
    
    if (this.seen.has(ad.ad_fingerprint)) {
      this.duplicateCount++;
      return false;
    }
    
    this.seen.add(ad.ad_fingerprint);
    return true;
  }
  
  loadExisting(fingerprints: string[]) {
    for (const fp of fingerprints) {
      this.seen.add(fp);
    }
  }
  
  get stats() {
    return {
      unique: this.seen.size,
      duplicates: this.duplicateCount,
    };
  }
}

/**
 * Build the Meta Ad Library URL with filters
 */
export function buildSearchUrl(
  query: SearchQuery,
  country: string,
  adStatus: string,
  adType: string,
  mediaType: string
): string {
  const params = new URLSearchParams({
    active_status: adStatus === 'all' ? 'all' : adStatus,
    ad_type: adType,
    country: country,
    q: query.location ? `${query.keyword} ${query.location}` : query.keyword,
    sort_data: JSON.stringify([{ direction: 'desc', mode: 'relevancy_monthly_grouped' }]),
    search_type: 'keyword_unordered',
    media_type: mediaType,
  });

  return `${AD_LIBRARY_BASE}?${params.toString()}`;
}

/**
 * Wait for ads to load - FAST version
 */
async function waitForAds(page: Page, timeout = 10000): Promise<boolean> {
  try {
    await Promise.race([
      page.waitForSelector('[data-testid="ad_archive_renderer_card"]', { timeout }),
      page.waitForSelector('div[role="article"]', { timeout }),
      page.waitForSelector('text=No ads match', { timeout: 5000 }).catch(() => null),
    ]);
    
    await page.waitForTimeout(1000);
    return true;
  } catch {
    return false;
  }
}

/**
 * Fast scroll and load more ads
 */
async function scrollForMore(page: Page, maxAds: number): Promise<number> {
  let previousCount = 0;
  let noNewAdsCount = 0;
  const maxNoNewAds = 2;
  
  while (noNewAdsCount < maxNoNewAds) {
    const currentCount = await page.evaluate(() => {
      const cards = document.querySelectorAll('[data-testid="ad_archive_renderer_card"], div[role="article"]');
      return cards.length;
    });
    
    if (currentCount >= maxAds) {
      log.debug(`Reached max ads limit: ${currentCount}`);
      break;
    }
    
    if (currentCount === previousCount) {
      noNewAdsCount++;
    } else {
      noNewAdsCount = 0;
    }
    
    previousCount = currentCount;
    
    await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight);
    });
    
    await page.waitForTimeout(800);
    
    try {
      const seeMoreButton = await page.$('text=See more');
      if (seeMoreButton) {
        await seeMoreButton.click();
        await page.waitForTimeout(500);
      }
    } catch {
      // No button, continue
    }
  }
  
  return previousCount;
}

/**
 * Extract ads from page
 */
async function extractAdsFromPage(page: Page, query: SearchQuery): Promise<MetaAd[]> {
  const ads = await page.evaluate((searchQuery) => {
    const results: any[] = [];
    const cards = document.querySelectorAll('[data-testid="ad_archive_renderer_card"], div[role="article"]');
    
    cards.forEach((card, index) => {
      try {
        const pageNameEl = card.querySelector('a[href*="/ads/library/?active_status"]') ||
                          card.querySelector('h3') ||
                          card.querySelector('span[dir="auto"]');
        const pageName = pageNameEl?.textContent?.trim() || 'Unknown';
        
        let pageId = '';
        const pageLink = card.querySelector('a[href*="page_id="]');
        if (pageLink) {
          const href = pageLink.getAttribute('href') || '';
          const match = href.match(/page_id=(\d+)/);
          if (match) pageId = match[1];
        }
        
        const profileImg = card.querySelector('img[src*="scontent"]');
        const profilePicture = profileImg?.getAttribute('src') || '';
        
        const textContainer = card.querySelector('div[style*="webkit-line-clamp"]') ||
                             card.querySelector('div[data-testid="ad_archive_renderer_card_body"]') ||
                             card.querySelector('span[dir="auto"]:not(:first-child)');
        const adText = textContainer?.textContent?.trim() || '';
        
        const images = card.querySelectorAll('img:not([src*="scontent"])');
        const videos = card.querySelectorAll('video');
        const mediaUrls: string[] = [];
        
        images.forEach(img => {
          const src = img.getAttribute('src');
          if (src && !src.includes('emoji') && !src.includes('static')) {
            mediaUrls.push(src);
          }
        });
        
        videos.forEach(video => {
          const src = video.getAttribute('src') || video.querySelector('source')?.getAttribute('src');
          if (src) mediaUrls.push(src);
        });
        
        let mediaType: string = 'none';
        if (videos.length > 0) mediaType = 'video';
        else if (mediaUrls.length > 1) mediaType = 'carousel';
        else if (mediaUrls.length === 1) mediaType = 'image';
        
        const dateText = card.textContent || '';
        const startDateMatch = dateText.match(/Started running on ([A-Za-z]+ \d+, \d+)/);
        const startDate = startDateMatch ? startDateMatch[1] : '';
        
        const isActive = !dateText.includes('Inactive') && !dateText.includes('stopped');
        
        const platforms: string[] = [];
        if (dateText.includes('Facebook')) platforms.push('facebook');
        if (dateText.includes('Instagram')) platforms.push('instagram');
        if (dateText.includes('Messenger')) platforms.push('messenger');
        if (dateText.includes('Audience Network')) platforms.push('audience_network');
        if (platforms.length === 0) platforms.push('facebook');
        
        let spendLower, spendUpper, impressionsLower, impressionsUpper;
        const spendMatch = dateText.match(/\$(\d+(?:,\d+)?)\s*-\s*\$(\d+(?:,\d+)?)/);
        if (spendMatch) {
          spendLower = parseInt(spendMatch[1].replace(',', ''));
          spendUpper = parseInt(spendMatch[2].replace(',', ''));
        }
        
        const impMatch = dateText.match(/(\d+(?:,\d+)?)\s*-\s*(\d+(?:,\d+)?)\s*impressions/i);
        if (impMatch) {
          impressionsLower = parseInt(impMatch[1].replace(',', ''));
          impressionsUpper = parseInt(impMatch[2].replace(',', ''));
        }
        
        const ctaButton = card.querySelector('a[role="button"], button');
        const ctaText = ctaButton?.textContent?.trim() || '';
        
        const timestamp = Date.now();
        const adId = `${pageId || pageName.replace(/\s/g, '_')}_${timestamp}_${index}`;
        
        results.push({
          ad_id: adId,
          ad_fingerprint: '',
          page_id: pageId,
          page_name: pageName,
          page_profile_picture_url: profilePicture,
          ad_text: adText,
          media_type: mediaType,
          media_urls: mediaUrls,
          cta_text: ctaText,
          ad_delivery_start_time: startDate,
          is_active: isActive,
          platforms: platforms,
          spend_lower: spendLower,
          spend_upper: spendUpper,
          impressions_lower: impressionsLower,
          impressions_upper: impressionsUpper,
          search_query: searchQuery.keyword,
          search_location: searchQuery.location || '',
          scraped_at: new Date().toISOString(),
          source_url: window.location.href,
        });
      } catch (e) {
        // Skip malformed card
      }
    });
    
    return results;
  }, query);
  
  const adsWithFingerprints = (ads as MetaAd[]).map(ad => {
    ad.ad_fingerprint = generateAdFingerprint(ad);
    return ad;
  });
  
  return adsWithFingerprints;
}

/**
 * Main scraping function for a single query
 */
export async function scrapeQuery(
  page: Page,
  query: SearchQuery,
  country: string,
  maxAds: number,
  adStatus: string,
  adType: string,
  mediaType: string
): Promise<MetaAd[]> {
  const url = buildSearchUrl(query, country, adStatus, adType, mediaType);
  
  // Navigate with retry
  let navSuccess = false;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      await page.goto(url, { 
        waitUntil: 'domcontentloaded',
        timeout: 30000 
      });
      navSuccess = true;
      break;
    } catch (error) {
      if (attempt === 2) throw error;
      await page.waitForTimeout(1000);
    }
  }
  
  if (!navSuccess) {
    throw new Error('Navigation failed');
  }
  
  // Wait for ads to load
  const loaded = await waitForAds(page);
  if (!loaded) {
    log.warning(`No ads loaded for "${query.keyword}"`);
    return [];
  }
  
  // Check for blocking
  const pageContent = await page.content();
  if (pageContent.includes('Please try again later') || 
      pageContent.includes('something went wrong')) {
    throw new Error('Rate limited or blocked');
  }
  
  // Check for no results
  if (pageContent.includes('No ads match') || 
      pageContent.includes('no results')) {
    log.info(`No ads found for "${query.keyword}"`);
    return [];
  }
  
  // Scroll to load more ads
  await scrollForMore(page, maxAds);
  
  // Extract ads
  const ads = await extractAdsFromPage(page, query);
  
  return ads.slice(0, maxAds);
}
