/**
 * Core scraping logic for Meta Ads Library
 * Optimized for efficiency and reliability
 */

import { Page } from 'playwright';
import { MetaAd, SearchQuery } from './types.js';
import { log } from 'crawlee';

const AD_LIBRARY_BASE = 'https://www.facebook.com/ads/library/';

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
 * Wait for ads to load with smart detection
 */
async function scrollAndLoadMore(page: Page, timeout = 15000): Promise<boolean> {
  try {
    // Wait for either ads container or "no results" message
    await Promise.race([
      page.waitForSelector('[data-testid="ad_archive_renderer_card"]', { timeout }),
      page.waitForSelector('div[role="article"]', { timeout }),
      page.waitForSelector('text=No ads match', { timeout: 5000 }).catch(() => null),
    ]);
    
    // Additional wait for dynamic content
    await page.waitForTimeout(2000);
    return true;
  } catch {
    return false;
  }
}

/**
 * Scroll and load more ads
 */
async function scrollAndLoadMore(
  page: Page, 
  maxAds: number,
  currentCount: number
): Promise<number> {
  let previousCount = currentCount;
  let noNewAdsCount = 0;
  const maxScrollAttempts = 50;
  
  for (let i = 0; i < maxScrollAttempts && currentCount < maxAds; i++) {
    // Scroll down
    await page.evaluate(() => {
      window.scrollBy(0, 800);
    });
    
    // Human-like delay
    await page.waitForTimeout(1500 + Math.random() * 1500);
    
    // Count current ads
    const newCount = await page.evaluate(() => {
      const cards = document.querySelectorAll('[data-testid="ad_archive_renderer_card"], div[role="article"]');
      return cards.length;
    });
    
    if (newCount === previousCount) {
      noNewAdsCount++;
      if (noNewAdsCount >= 3) {
        log.info(`No new ads after ${noNewAdsCount} scroll attempts, stopping`);
        break;
      }
    } else {
      noNewAdsCount = 0;
      previousCount = newCount;
    }
    
    currentCount = newCount;
    log.debug(`Scroll ${i + 1}: Found ${currentCount} ads`);
  }
  
  return currentCount;
}

/**
 * Extract ad data from page
 */
export async function extractAds(
  page: Page,
  query: SearchQuery,
  sourceUrl: string
): Promise<MetaAd[]> {
  const ads = await page.evaluate((params) => {
    const { queryKeyword, queryLocation, sourceUrl } = params;
    const results: any[] = [];
    
    // Find all ad cards
    const adCards = document.querySelectorAll('[data-testid="ad_archive_renderer_card"], div[role="article"]');
    
    adCards.forEach((card, index) => {
      try {
        // Extract page info
        const pageNameEl = card.querySelector('a[href*="/ads/library/?active_status"][role="link"] span, h4 a, strong');
        const pageName = pageNameEl?.textContent?.trim() || 'Unknown';
        
        // Extract page ID from link
        const pageLinkEl = card.querySelector('a[href*="facebook.com/"]');
        const pageLink = pageLinkEl?.getAttribute('href') || '';
        const pageIdMatch = pageLink.match(/facebook\.com\/(\d+)/);
        const pageId = pageIdMatch ? pageIdMatch[1] : `unknown_${index}`;
        
        // Extract profile picture
        const profilePicEl = card.querySelector('img[src*="scontent"]');
        const profilePicUrl = profilePicEl?.getAttribute('src') || '';
        
        // Extract ad text/body
        const adTextEls = card.querySelectorAll('div[data-testid="ad_archive_renderer_description"] span, div[dir="auto"] span');
        const adTexts: string[] = [];
        adTextEls.forEach(el => {
          const text = el.textContent?.trim();
          if (text && text.length > 20 && !adTexts.includes(text)) {
            adTexts.push(text);
          }
        });
        
        // Extract media
        const imageEls = card.querySelectorAll('img[src*="scontent"]:not([src*="profile"]):not([width="40"])');
        const videoEl = card.querySelector('video');
        const mediaUrls: string[] = [];
        
        imageEls.forEach(img => {
          const src = img.getAttribute('src');
          if (src && !src.includes('emoji') && !mediaUrls.includes(src)) {
            mediaUrls.push(src);
          }
        });
        
        const videoUrl = videoEl?.getAttribute('src') || '';
        if (videoUrl) mediaUrls.push(videoUrl);
        
        // Determine media type
        let mediaType: 'image' | 'video' | 'carousel' | 'none' = 'none';
        if (videoUrl) mediaType = 'video';
        else if (mediaUrls.length > 1) mediaType = 'carousel';
        else if (mediaUrls.length === 1) mediaType = 'image';
        
        // Extract CTA
        const ctaEl = card.querySelector('a[role="link"][href*="l.facebook.com"], button span');
        const ctaText = ctaEl?.textContent?.trim() || '';
        
        // Extract link info
        const linkTitleEl = card.querySelector('div[data-testid="ad_archive_renderer_caption"] span');
        const linkTitle = linkTitleEl?.textContent?.trim() || '';
        
        // Extract dates (look for "Started running on" text)
        const dateText = card.textContent || '';
        const startDateMatch = dateText.match(/Started running on\s+(\w+\s+\d+,?\s*\d*)/i);
        const startDate = startDateMatch ? startDateMatch[1] : '';
        
        // Extract platforms
        const platformText = card.textContent || '';
        const platforms: string[] = [];
        if (platformText.includes('Facebook')) platforms.push('facebook');
        if (platformText.includes('Instagram')) platforms.push('instagram');
        if (platformText.includes('Messenger')) platforms.push('messenger');
        if (platformText.includes('Audience Network')) platforms.push('audience_network');
        
        // Extract spend (if visible)
        const spendMatch = dateText.match(/\$?([\d,]+)\s*-\s*\$?([\d,]+)/);
        const spendLower = spendMatch ? parseInt(spendMatch[1].replace(/,/g, '')) : undefined;
        const spendUpper = spendMatch ? parseInt(spendMatch[2].replace(/,/g, '')) : undefined;
        
        // Extract impressions
        const impressionsMatch = dateText.match(/([\d,]+)\s*-\s*([\d,]+)\s*impression/i);
        const impressionsLower = impressionsMatch ? parseInt(impressionsMatch[1].replace(/,/g, '')) : undefined;
        const impressionsUpper = impressionsMatch ? parseInt(impressionsMatch[2].replace(/,/g, '')) : undefined;
        
        // Generate unique ad ID
        const adId = `${pageId}_${Date.now()}_${index}`;
        
        results.push({
          ad_id: adId,
          ad_fingerprint: '', // Will be generated after extraction
          page_id: pageId,
          page_name: pageName,
          page_profile_picture_url: profilePicUrl,
          page_profile_uri: pageLink,
          ad_text: adTexts[0] || '',
          ad_creative_bodies: adTexts,
          ad_creative_link_titles: linkTitle ? [linkTitle] : [],
          cta_text: ctaText,
          media_type: mediaType,
          media_urls: mediaUrls,
          ad_delivery_start_time: startDate,
          is_active: true,
          currency: spendLower !== undefined ? 'USD' : undefined,
          spend_lower: spendLower,
          spend_upper: spendUpper,
          impressions_lower: impressionsLower,
          impressions_upper: impressionsUpper,
          platforms: platforms.length > 0 ? platforms : ['facebook'],
          search_query: queryKeyword,
          search_location: queryLocation,
          scraped_at: new Date().toISOString(),
          source_url: sourceUrl,
        });
      } catch (e) {
        console.error('Error extracting ad:', e);
      }
    });
    
    return results;
  }, {
    queryKeyword: query.keyword,
    queryLocation: query.location || '',
    sourceUrl,
  });
  
  // Generate fingerprints for each ad
  const adsWithFingerprints = (ads as MetaAd[]).map(ad => {
    ad.ad_fingerprint = generateAdFingerprint(ad);
    return ad;
  });
  
  return adsWithFingerprints;
}

/**
 * Main scrape function for a single query
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
  log.info(`Scraping: ${query.keyword} ${query.location || ''} - ${url}`);
  
  try {
    // Navigate with retry logic
    let retries = 3;
    while (retries > 0) {
      try {
        await page.goto(url, { 
          waitUntil: 'domcontentloaded',
          timeout: 60000 
        });
        break;
      } catch (e) {
        retries--;
        if (retries === 0) throw e;
        log.warning(`Navigation failed, retrying... (${retries} left)`);
        await page.waitForTimeout(2000);
      }
    }
    
    // Wait for initial load
    const loaded = await waitForAdsToLoad(page);
    if (!loaded) {
      log.warning('No ads loaded for query');
      return [];
    }
    
    // Check for blocking/captcha
    const pageContent = await page.content();
    if (pageContent.includes('unusual traffic') || pageContent.includes('checkpoint')) {
      throw new Error('Blocked by Facebook - try different proxy');
    }
    
    // Get initial count
    let adCount = await page.evaluate(() => {
      return document.querySelectorAll('[data-testid="ad_archive_renderer_card"], div[role="article"]').length;
    });
    
    log.info(`Initial ads found: ${adCount}`);
    
    // Scroll to load more if needed
    if (adCount < maxAds) {
      adCount = await scrollAndLoadMore(page, maxAds, adCount);
    }
    
    // Extract all ads
    const ads = await extractAds(page, query, url);
    
    // Limit to maxAds
    const limitedAds = ads.slice(0, maxAds);
    log.info(`Extracted ${limitedAds.length} ads for query: ${query.keyword}`);
    
    return limitedAds;
    
  } catch (error) {
    log.error(`Error scraping query ${query.keyword}: ${error}`);
    throw error;
  }
}

/**
 * Generate a unique fingerprint for an ad
 * This allows deduplication across different scrape runs
 */
export function generateAdFingerprint(ad: Partial<MetaAd>): string {
  // Combine multiple fields to create a unique identifier
  const components = [
    ad.page_id || '',
    ad.page_name || '',
    // Normalize ad text: lowercase, remove extra whitespace, first 200 chars
    (ad.ad_text || '').toLowerCase().replace(/\s+/g, ' ').trim().substring(0, 200),
    // First media URL (most stable identifier for creative)
    (ad.media_urls?.[0] || '').split('?')[0], // Remove query params
    // CTA text
    (ad.cta_text || '').toLowerCase(),
  ].join('|');
  
  // Create a simple hash
  let hash = 0;
  for (let i = 0; i < components.length; i++) {
    const char = components.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  
  // Return as hex string with prefix for readability
  return `meta_${Math.abs(hash).toString(16).padStart(8, '0')}`;
}

/**
 * Deduplicate ads by fingerprint
 */
export function deduplicateAds(ads: MetaAd[]): MetaAd[] {
  const seen = new Set<string>();
  const unique: MetaAd[] = [];
  
  for (const ad of ads) {
    // Generate fingerprint if not already set
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
 * Create a deduplication tracker for use during scraping
 */
export class DeduplicationTracker {
  private seen = new Set<string>();
  private duplicateCount = 0;
  
  /**
   * Check if ad is duplicate and track it
   * Returns true if ad is NEW (not a duplicate)
   */
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
  
  /**
   * Pre-load existing fingerprints from database
   */
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
