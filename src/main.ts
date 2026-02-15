/**
 * Meta Ads Library Scraper - Main Entry Point
 * Optimized for Apify Creator Plan efficiency
 */

import { Actor, ProxyConfiguration } from 'apify';
import { PlaywrightCrawler, log } from 'crawlee';
import { scrapeQuery, deduplicateAds, DeduplicationTracker } from './scraper.js';
import { ActorInput, MetaAd, WebhookPayload } from './types.js';

// Default input values
const DEFAULT_INPUT: Partial<ActorInput> = {
  country: 'US',
  maxAdsPerQuery: 100,
  adStatus: 'active',
  adType: 'all',
  mediaType: 'all',
  scrapeAdDetails: false,
  webhookBatchSize: 50,
};

async function main() {
  await Actor.init();
  
  // Get and validate input
  const rawInput = await Actor.getInput<Partial<ActorInput>>();
  const input: ActorInput = { ...DEFAULT_INPUT, ...rawInput } as ActorInput;
  
  if (!input.searchQueries || input.searchQueries.length === 0) {
    log.error('No search queries provided!');
    await Actor.exit({ exitCode: 1 });
    return;
  }
  
  log.info('=' .repeat(50));
  log.info('🚀 META ADS LIBRARY SCRAPER');
  log.info(`📋 Queries: ${input.searchQueries.length}`);
  log.info(`🌍 Country: ${input.country}`);
  log.info(`📊 Max ads per query: ${input.maxAdsPerQuery}`);
  log.info(`🔗 Webhook: ${input.webhookUrl || 'Not configured'}`);
  log.info('=' .repeat(50));
  
  // Setup proxy configuration
  const proxyConfiguration = await Actor.createProxyConfiguration({
    useApifyProxy: input.proxyConfiguration?.useApifyProxy ?? true,
    apifyProxyGroups: input.proxyConfiguration?.apifyProxyGroups ?? ['RESIDENTIAL'],
  });
  
  // Track all collected ads
  const allAds: MetaAd[] = [];
  let totalProcessed = 0;
  let batchNumber = 0;
  
  // Initialize deduplication tracker
  const dedupeTracker = new DeduplicationTracker();
  
  // Optional: Load existing fingerprints from Supabase to avoid re-scraping
  if (input.webhookUrl) {
    try {
      // Try to fetch existing fingerprints from a dedicated endpoint
      const checkUrl = input.webhookUrl.replace('/import-ads', '/get-fingerprints');
      const response = await fetch(checkUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          queries: input.searchQueries.map(q => q.keyword) 
        }),
      });
      
      if (response.ok) {
        const data = await response.json();
        if (data.fingerprints?.length > 0) {
          dedupeTracker.loadExisting(data.fingerprints);
          log.info(`📋 Loaded ${data.fingerprints.length} existing fingerprints for deduplication`);
        }
      }
    } catch (e) {
      log.debug('Could not load existing fingerprints (endpoint may not exist)');
    }
  }
  
  // Send batch to webhook
  async function sendToWebhook(ads: MetaAd[], query: typeof input.searchQueries[0], isFinal = false) {
    if (!input.webhookUrl || ads.length === 0) return;
    
    batchNumber++;
    const payload: WebhookPayload = {
      actorRunId: Actor.getEnv().actorRunId || 'unknown',
      batchNumber,
      ads,
      query,
      timestamp: new Date().toISOString(),
      isFinal,
    };
    
    try {
      const response = await fetch(input.webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Actor-Run-Id': payload.actorRunId,
          'X-Batch-Number': String(batchNumber),
          'X-Is-Final': String(isFinal),
        },
        body: JSON.stringify(payload),
      });
      
      if (response.ok) {
        log.info(`📤 Webhook batch ${batchNumber}: Sent ${ads.length} ads`);
      } else {
        log.warning(`⚠️ Webhook failed: ${response.status} ${response.statusText}`);
      }
    } catch (error) {
      log.error(`❌ Webhook error: ${error}`);
    }
  }
  
  // Create crawler with minimal resource usage
  const crawler = new PlaywrightCrawler({
    proxyConfiguration,
    maxConcurrency: 2,
    maxRequestsPerMinute: 10,
    requestHandlerTimeoutSecs: 300,
    navigationTimeoutSecs: 60,
    
    launchContext: {
      launchOptions: {
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--single-process',
        ],
      },
    },
    
    browserPoolOptions: {
      useFingerprints: true,
      maxOpenPagesPerBrowser: 1,
    },
    
    async requestHandler({ page, request }) {
      const query = request.userData.query as typeof input.searchQueries[0];
      
      log.info(`🔍 Scraping: "${query.keyword}" ${query.location ? `in ${query.location}` : ''}`);
      
      // Set viewport and headers
      await page.setViewportSize({ width: 1366, height: 768 });
      await page.setExtraHTTPHeaders({
        'Accept-Language': 'en-US,en;q=0.9',
      });
      
      try {
        // Scrape this query
        const rawAds = await scrapeQuery(
          page,
          query,
          input.country,
          input.maxAdsPerQuery,
          input.adStatus,
          input.adType,
          input.mediaType
        );
        
        // Filter out duplicates using tracker
        const ads = rawAds.filter(ad => dedupeTracker.isNew(ad));
        const duplicatesSkipped = rawAds.length - ads.length;
        
        if (duplicatesSkipped > 0) {
          log.info(`🔄 Skipped ${duplicatesSkipped} duplicate ads`);
        }
        
        // Add to collection
        allAds.push(...ads);
        totalProcessed += ads.length;
        
        log.info(`✅ Found ${ads.length} new ads for "${query.keyword}"`);
        
        // Stream to dataset immediately
        if (ads.length > 0) {
          await Actor.pushData(ads);
          
          // Send webhook batches
          if (input.webhookUrl) {
            const batchSize = input.webhookBatchSize || 50;
            for (let i = 0; i < ads.length; i += batchSize) {
              const batch = ads.slice(i, i + batchSize);
              await sendToWebhook(batch, query);
            }
          }
        }
        
      } catch (error) {
        log.error(`❌ Error scraping "${query.keyword}": ${error}`);
      }
    },
    
    async failedRequestHandler({ request }) {
      const query = request.userData.query;
      log.error(`💀 Failed: "${query?.keyword}" after ${request.retryCount} retries`);
    },
  });
  
  // Build request list from search queries
  const requests = input.searchQueries.map((query, index) => ({
    url: `https://www.facebook.com/ads/library/?active_status=${input.adStatus}&ad_type=${input.adType}&country=${input.country}&q=${encodeURIComponent(query.keyword + (query.location ? ' ' + query.location : ''))}`,
    uniqueKey: `query-${index}-${query.keyword}-${query.location || 'all'}`,
    userData: { query },
  }));
  
  // Run the crawler
  await crawler.run(requests);
  
  // Final deduplication (belt and suspenders)
  const uniqueAds = deduplicateAds(allAds);
  
  // Get deduplication stats
  const dedupeStats = dedupeTracker.stats;
  
  // Summary
  log.info('=' .repeat(50));
  log.info('📊 SCRAPING COMPLETE');
  log.info(`Total queries processed: ${input.searchQueries.length}`);
  log.info(`Total ads scraped: ${totalProcessed}`);
  log.info(`Duplicates skipped (in-run): ${dedupeStats.duplicates}`);
  log.info(`Unique ads saved: ${uniqueAds.length}`);
  log.info('=' .repeat(50));
  
  // Store summary in key-value store
  await Actor.setValue('SUMMARY', {
    queriesProcessed: input.searchQueries.length,
    totalAdsScraped: totalProcessed,
    uniqueAds: uniqueAds.length,
    duplicatesSkipped: dedupeStats.duplicates,
    webhookBatches: batchNumber,
    completedAt: new Date().toISOString(),
  });
  
  await Actor.exit();
}

main().catch(async (error) => {
  log.error(`Fatal error: ${error}`);
  await Actor.exit({ exitCode: 1 });
});
