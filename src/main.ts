import { Actor } from 'apify';
import { PlaywrightCrawler, log } from 'crawlee';
import { scrapeQuery, deduplicateAds, DeduplicationTracker } from './scraper.js';
import { ActorInput, MetaAd, WebhookPayload } from './types.js';

const DEFAULT_INPUT: Partial<ActorInput> = {
  country: 'US',
  maxAdsPerQuery: 100,
  adStatus: 'active',
  adType: 'all',
  mediaType: 'all',
  scrapeAdDetails: false,
  webhookBatchSize: 100,
};

async function main() {
  await Actor.init();
  
  const rawInput = await Actor.getInput<Partial<ActorInput>>();
  const input: ActorInput = { ...DEFAULT_INPUT, ...rawInput } as ActorInput;
  
  if (!input.searchQueries || input.searchQueries.length === 0) {
    log.error('No search queries provided!');
    await Actor.exit({ exitCode: 1 });
    return;
  }
  
  log.info('='.repeat(60));
  log.info('META ADS LIBRARY SCRAPER - AGGRESSIVE MODE');
  log.info('='.repeat(60));
  log.info('Queries: ' + input.searchQueries.length);
  log.info('Country: ' + input.country);
  log.info('Max ads per query: ' + input.maxAdsPerQuery);
  log.info('Concurrency: 8 browsers');
  log.info('Rate: 120 requests/minute');
  log.info('Webhook: ' + (input.webhookUrl || 'Not configured'));
  log.info('Proxy input: ' + JSON.stringify(input.proxyConfiguration));
  
  const proxyConfiguration = await Actor.createProxyConfiguration(
    input.proxyConfiguration || {
      useApifyProxy: true,
      apifyProxyGroups: ['RESIDENTIAL'],
      apifyProxyCountry: 'US',
    }
  );
  
  log.info('Proxy active: ' + (proxyConfiguration ? 'YES' : 'NO'));
  log.info('='.repeat(60));
  
  const allAds: MetaAd[] = [];
  let totalProcessed = 0;
  let batchNumber = 0;
  let queriesCompleted = 0;
  const startTime = Date.now();
  
  const dedupeTracker = new DeduplicationTracker();
  
  if (input.webhookUrl) {
    try {
      const checkUrl = input.webhookUrl.replace('/import-ads', '/get-fingerprints');
      const response = await fetch(checkUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ queries: input.searchQueries.map(q => q.keyword) }),
      });
      
      if (response.ok) {
        const data = await response.json();
        if (data.fingerprints?.length > 0) {
          dedupeTracker.loadExisting(data.fingerprints);
          log.info('Loaded ' + data.fingerprints.length + ' existing fingerprints');
        }
      }
    } catch (e) {
      log.debug('Could not load existing fingerprints');
    }
  }
  
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
        log.warning('Webhook failed: ' + response.status);
      }
    } catch (error) {
      log.error('Webhook error: ' + error);
    }
  }
  
  function logProgress() {
    const elapsed = (Date.now() - startTime) / 1000 / 60;
    const adsPerMin = elapsed > 0 ? totalProcessed / elapsed : 0;
    const remaining = input.searchQueries.length - queriesCompleted;
    const eta = queriesCompleted > 0 ? remaining / (queriesCompleted / elapsed) : 0;
    log.info('Progress: ' + queriesCompleted + '/' + input.searchQueries.length + ' queries | ' + totalProcessed + ' ads | ' + adsPerMin.toFixed(0) + ' ads/min');
  }
  
  const crawler = new PlaywrightCrawler({
    proxyConfiguration,
    maxConcurrency: 8,
    maxRequestsPerMinute: 120,
    requestHandlerTimeoutSecs: 180,
    navigationTimeoutSecs: 45,
    maxRequestRetries: 3,
    
    launchContext: {
      launchOptions: {
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--disable-web-security',
        ],
      },
    },
    
    browserPoolOptions: {
      useFingerprints: true,
      maxOpenPagesPerBrowser: 2,
      retireBrowserAfterPageCount: 10,
    },
    
    preNavigationHooks: [
      async ({ page }, gotoOptions) => {
        await page.setExtraHTTPHeaders({
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept-Encoding': 'gzip, deflate, br',
          'Connection': 'keep-alive',
          'Upgrade-Insecure-Requests': '1',
        });
        await page.setViewportSize({ width: 1366, height: 768 });
        gotoOptions.waitUntil = 'domcontentloaded';
        gotoOptions.timeout = 45000;
      },
    ],
    
    async requestHandler({ page, request, proxyInfo }) {
      const query = request.userData.query as typeof input.searchQueries[0];
      
      log.info('Scraping: "' + query.keyword + '" via proxy: ' + (proxyInfo?.hostname || 'NONE'));
      
      try {
        const rawAds = await scrapeQuery(
          page,
          query,
          input.country,
          input.maxAdsPerQuery,
          input.adStatus,
          input.adType,
          input.mediaType
        );
        
        const ads = rawAds.filter(ad => dedupeTracker.isNew(ad));
        const duplicatesSkipped = rawAds.length - ads.length;
        
        allAds.push(...ads);
        totalProcessed += ads.length;
        queriesCompleted++;
        
        log.info('Done [' + queriesCompleted + '/' + input.searchQueries.length + '] "' + query.keyword + '" -> ' + ads.length + ' ads');
        
        if (ads.length > 0) {
          await Actor.pushData(ads);
          
          if (input.webhookUrl) {
            const batchSize = input.webhookBatchSize || 100;
            for (let i = 0; i < ads.length; i += batchSize) {
              const batch = ads.slice(i, i + batchSize);
              await sendToWebhook(batch, query);
            }
          }
        }
        
        if (queriesCompleted % 10 === 0) {
          logProgress();
        }
        
      } catch (error) {
        log.error('Error scraping "' + query.keyword + '": ' + error);
        queriesCompleted++;
      }
    },
    
    async failedRequestHandler({ request, proxyInfo }) {
      const query = request.userData.query;
      log.warning('Failed: "' + query?.keyword + '" - proxy was: ' + (proxyInfo?.hostname || 'NONE'));
      queriesCompleted++;
    },
  });
  
  const requests = input.searchQueries.map((query, index) => ({
    url: 'https://www.facebook.com/ads/library/?active_status=' + input.adStatus + '&ad_type=' + input.adType + '&country=' + input.country + '&q=' + encodeURIComponent(query.keyword + (query.location ? ' ' + query.location : '')),
    uniqueKey: 'query-' + index + '-' + query.keyword + '-' + (query.location || 'all'),
    userData: { query, index },
  }));
  
  log.info('Starting crawler with ' + requests.length + ' queries...');
  await crawler.run(requests);
  
  const totalTime = (Date.now() - startTime) / 1000 / 60;
  const uniqueAds = deduplicateAds(allAds);
  const dedupeStats = dedupeTracker.stats;
  
  log.info('='.repeat(60));
  log.info('SCRAPING COMPLETE');
  log.info('='.repeat(60));
  log.info('Total time: ' + totalTime.toFixed(1) + ' minutes');
  log.info('Queries processed: ' + queriesCompleted + '/' + input.searchQueries.length);
  log.info('Total ads scraped: ' + totalProcessed);
  log.info('Duplicates skipped: ' + dedupeStats.duplicates);
  log.info('Unique ads: ' + uniqueAds.length);
  log.info('Rate: ' + (totalProcessed / Math.max(totalTime, 0.1)).toFixed(0) + ' ads/minute');
  log.info('='.repeat(60));
  
  await Actor.setValue('SUMMARY', {
    queriesProcessed: queriesCompleted,
    totalQueries: input.searchQueries.length,
    totalAdsScraped: totalProcessed,
    uniqueAds: uniqueAds.length,
    duplicatesSkipped: dedupeStats.duplicates,
    webhookBatches: batchNumber,
    totalTimeMinutes: totalTime,
    adsPerMinute: totalProcessed / Math.max(totalTime, 0.1),
    completedAt: new Date().toISOString(),
  });
  
  await Actor.exit();
}

main().catch(async (error) => {
  log.error('Fatal error: ' + error);
  await Actor.exit({ exitCode: 1 });
});
