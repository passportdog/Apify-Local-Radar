/**
 * Bright Data Scraper Studio - Meta Ad Library Scraper
 * 
 * This file contains the configuration for Scraper Studio IDE.
 * Copy this into the Scraper Studio IDE at:
 * https://brightdata.com/cp/ide
 * 
 * The scraper will:
 * 1. Open Meta Ad Library with search parameters
 * 2. Scroll to load all ads
 * 3. Extract ad data using text-walking
 * 4. Send results to your webhook
 */

// ============================================
// SCRAPER STUDIO INTERACTION CODE
// Paste this in the "Interaction" tab
// ============================================

async function fetchData({ keyword, location }) {
  const searchTerm = location ? `${keyword} ${location}` : keyword;
  
  const url = `https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=US&q=${encodeURIComponent(searchTerm)}&search_type=keyword_unordered&media_type=all`;
  
  console.log(`Scraping: ${searchTerm}`);
  
  // Navigate to page
  await page.goto(url, {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  
  // Wait for content
  await new Promise(r => setTimeout(r, 3000));
  
  // Scroll to load more ads
  for (let i = 0; i < 5; i++) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await new Promise(r => setTimeout(r, 400));
  }
  
  // Extract ads using text-walking
  const ads = await page.evaluate(() => {
    const results = [];
    const seen = new Set();
    
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    
    while ((node = walker.nextNode())) {
      if (!node.textContent?.includes('Started running')) continue;
      
      let container = node.parentElement;
      let depth = 0;
      let containerHTML = '';
      
      while (container && depth < 20) {
        containerHTML = container.innerHTML;
        if (containerHTML.length > 3000 && containerHTML.includes('scontent')) break;
        container = container.parentElement;
        depth++;
      }
      
      if (!container || containerHTML.length < 2000) continue;
      
      const html = containerHTML;
      const text = container.textContent || '';
      
      // Extract page name
      let pageName = 'Unknown';
      const allLinks = container.querySelectorAll('a');
      for (const link of allLinks) {
        const href = link.getAttribute('href') || '';
        const linkText = link.textContent?.trim() || '';
        
        if (href.startsWith('https://www.facebook.com/') && 
            !href.includes('/ads/') && 
            !href.includes('?') &&
            linkText.length > 1 &&
            linkText.length < 50 &&
            !linkText.includes('Sponsored')) {
          pageName = linkText;
          break;
        }
      }
      
      if (pageName === 'Unknown') {
        const strongEl = container.querySelector('strong, b');
        if (strongEl) {
          const t = strongEl.textContent?.trim() || '';
          if (t.length > 1 && t.length < 50) pageName = t;
        }
      }
      
      // Extract ad text
      let adText = '';
      const spans = container.querySelectorAll('span');
      for (const span of spans) {
        const t = span.textContent?.trim() || '';
        if (t.length > 50 && t.length < 1000 && t.length > adText.length) {
          if (!t.includes('Started running') && !t.includes('Sponsored') && t !== pageName) {
            adText = t;
          }
        }
      }
      
      // Extract images
      const mediaUrls = [];
      const imgs = container.querySelectorAll('img');
      for (const img of imgs) {
        const src = img.getAttribute('src') || '';
        if (src.includes('scontent') && !src.includes('50x50') && !src.includes('40x40')) {
          if (!mediaUrls.includes(src)) mediaUrls.push(src);
        }
      }
      
      const key = pageName + '_' + adText.substring(0, 100);
      if (seen.has(key)) continue;
      seen.add(key);
      
      let mediaType = 'image';
      if (html.includes('<video')) mediaType = 'video';
      else if (mediaUrls.length > 1) mediaType = 'carousel';
      
      const dateMatch = text.match(/Started running on ([A-Za-z]+ \d+, \d{4})/);
      
      results.push({
        ad_id: `${pageName.replace(/\s/g, '_')}_${Date.now()}_${results.length}`,
        page_name: pageName,
        ad_text: adText.substring(0, 500),
        media_urls: mediaUrls.slice(0, 5),
        media_type: mediaType,
        start_date: dateMatch ? dateMatch[1] : '',
      });
    }
    
    return results;
  });
  
  return {
    search_term: searchTerm,
    keyword: keyword,
    location: location,
    ads_found: ads.length,
    ads: ads,
    scraped_at: new Date().toISOString(),
  };
}

// Main function - called by Scraper Studio
async function run(input) {
  const { keyword, location } = input;
  
  if (!keyword) {
    throw new Error('keyword is required');
  }
  
  return await fetchData({ keyword, location });
}

// Scraper Studio automatically uses run(input) as the entry point
// No module.exports needed - this is top-level code
