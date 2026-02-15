/**
 * Meta Ads Library Scraper - AGGRESSIVE MODE
 * Optimized for MAXIMUM throughput on Apify
 * 
 * Settings: 8 concurrent browsers, 120 requests/min
 * Expected: 5,000-10,000 ads/hour
 * Memory: Requires 4GB RAM allocation
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
  webhookBatchSize: 100, // Larger batches for efficiency
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
  
  log.info('='.repeat(60));
  log.info('🚀 META ADS LIBRARY SCRAPER - AGGRESSIVE MODE');
  log.info('='.repeat(60));
  log.info(`📋 Queries: ${input.searchQueries.length}`);
  log.info(`🌍 Country: ${input.country}`);
  log.info(`📊 Max ads per query: ${input.maxAdsPerQuery}`);
  log.info(`⚡ Concurrency: 8 browsers`);
  log.info(`🔥 Rate: 120 requests/minute`);
  log.info(`🔗 Webhook: ${input.webhookUrl || 'Not configured'}`);
  log.info('='.repeat(60));
  
  // Setup proxy configuration
  const proxyConfiguration = await Actor.createProxyConfiguration({
    useApifyProxy: input.proxyConfiguration?.useApifyProxy ?? true,
    apifyProxyGroups: input.proxyConfiguration?.apifyProxyGroups ?? ['RESIDENTIAL'],
  });
  
  // Track all collected ads
  const allAds: MetaAd[] = [];
  let totalProcessed = 0;
  let batchNumber = 0;
  let queriesCompleted = 0;
  const startTime = Date.now();
  
  // Initialize deduplication tracker
  const dedupeTracker = new DeduplicationTracker();
  
  // Optional: Load existing fingerprints from Supabase
  if (input.webhookUrl) {
    try {
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
          log.info(`📋 Loaded ${data.fingerprints.length} existing fingerprints`);
        }
      }
    } catch (e) {
      log.debug('Could not load existing fingerprints');
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
      
      if (!response.ok) {
        log.warning(`⚠️ Webhook failed: ${response.status}`);
      }
    } catch (error) {
      log.error(`❌ Webhook error: ${error}`);
    }
  }
  
  // Progress logging
  function logProgress() {
    const elapsed = (Date.now() - startTime) / 1000 / 60; // minutes
    const adsPerMin = totalProcessed / elapsed;
    const remaining = input.searchQueries.length - queriesCompleted;
    const eta = remaining / (queriesCompleted / elapsed);
    
    log.info(`📈 Progress: ${queriesCompleted}/${input.searchQueries.length} queries | ${totalProcessed} ads | ${adsPerMin.toFixed(0)} ads/min | ETA: ${eta.toFixed(1)} min`);
  }
  
  // AGGRESSIVE CRAWLER CONFIGURATION
  const crawler = new PlaywrightCrawler({
    proxyConfiguration,
    
    // ⚡ AGGRESSIVE SETTINGS
    maxConcurrency: 8,              // 8 parallel browsers
    maxRequestsPerMinute: 120,      // 2 requests per second
    requestHandlerTimeoutSecs: 180, // 3 min timeout (faster fail)
    navigationTimeoutSecs: 45,      // 45 sec nav timeout
    maxRequestRetries: 2,           // Fewer retries, move on faster
    
    launchContext: {
      launchOptions: {
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--disable-web-security',
          '--disable-features=IsolateOrigins,site-per-process',
          '--single-process',
        ],
      },
    },
    
    browserPoolOptions: {
      useFingerprints: true,
      maxOpenPagesPerBrowser: 2, // 2 pages per browser for efficiency
      retireBrowserAfterPageCount: 20, // Fresh browser every 20 pages
    },
    
    // Minimal delays
    sameDomainDelaySecs: 0.5,  // 500ms between same domain requests
    
    async requestHandler({ page, request }) {
      const query = request.userData.query as typeof input.searchQueries[0];
      const queryIndex = request.userData.index as number;
      
      // Set viewport and headers quickly
      await page.setViewportSize({ width: 1366, height: 768 });
      
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
        
        // Filter duplicates
        const ads = rawAds.filter(ad => dedupeTracker.isNew(ad));
        const duplicatesSkipped = rawAds.length - ads.length;
        
        // Update counters
        allAds.push(...ads);
        totalProcessed += ads.length;
        queriesCompleted++;
        
        log.info(`✅ [${queriesCompleted}/${input.searchQueries.length}] "${query.keyword}" → ${ads.length} ads ${duplicatesSkipped > 0 ? `(${duplicatesSkipped} dupes skipped)` : ''}`);
        
        // Stream to dataset immediately
        if (ads.length > 0) {
          await Actor.pushData(ads);
          
          // Send webhook batches
          if (input.webhookUrl) {
            const batchSize = input.webhookBatchSize || 100;
            for (let i = 0; i < ads.length; i += batchSize) {
              const batch = ads.slice(i, i + batchSize);
              await sendToWebhook(batch, query);
            }
          }
        }
        
        // Log progress every 10 queries
        if (queriesCompleted % 10 === 0) {
          logProgress();
        }
        
      } catch (error) {
        log.error(`❌ Error scraping "${query.keyword}": ${error}`);
        queriesCompleted++;
      }
    },
    
    async failedRequestHandler({ request }) {
      const query = request.userData.query;
      log.warning(`💀 Failed: "${query?.keyword}" - moving on`);
      queriesCompleted++;
    },
  });
  
  // Build request list
  const requests = input.searchQueries.map((query, index) => ({
    url: `https://www.facebook.com/ads/library/?active_status=${input.adStatus}&ad_type=${input.adType}&country=${input.country}&q=${encodeURIComponent(query.keyword + (query.location ? ' ' + query.location : ''))}`,
    uniqueKey: `query-${index}-${query.keyword}-${query.location || 'all'}`,
    userData: { query, index },
  }));
  
  // Run the crawler
  log.info(`🏁 Starting crawler with ${requests.length} queries...`);
  await crawler.run(requests);
  
  // Final stats
  const totalTime = (Date.now() - startTime) / 1000 / 60;
  const uniqueAds = deduplicateAds(allAds);
  const dedupeStats = dedupeTracker.stats;
  
  log.info('='.repeat(60));
  log.info('📊 SCRAPING COMPLETE');
  log.info('='.repeat(60));
  log.info(`⏱️  Total time: ${totalTime.toFixed(1)} minutes`);
  log.info(`📋 Queries processed: ${queriesCompleted}/${input.searchQueries.length}`);
  log.info(`📦 Total ads scraped: ${totalProcessed}`);
  log.info(`🔄 Duplicates skipped: ${dedupeStats.duplicates}`);
  log.info(`✨ Unique ads: ${uniqueAds.length}`);
  log.info(`⚡ Rate: ${(totalProcessed / totalTime).toFixed(0)} ads/minute`);
  log.info(`📤 Webhook batches sent: ${batchNumber}`);
  log.info('='.repeat(60));
  
  // Store summary
  await Actor.setValue('SUMMARY', {
    queriesProcessed: queriesCompleted,
    totalQueries: input.searchQueries.length,
    totalAdsScraped: totalProcessed,
    uniqueAds: uniqueAds.length,
    duplicatesSkipped: dedupeStats.duplicates,
    webhookBatches: batchNumber,
    totalTimeMinutes: totalTime,
    adsPerMinute: totalProcessed / totalTime,
    completedAt: new Date().toISOString(),
  });
  
  await Actor.exit();
}

main().catch(async (error) => {
  log.error(`Fatal error: ${error}`);
  await Actor.exit({ exitCode: 1 });
});
