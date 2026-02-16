# Bright Data Scraper Studio - Meta Ad Library Scraper

This folder contains everything needed to run a custom Meta Ad Library scraper on **Bright Data Scraper Studio** - a fully managed, browser-based scraper that runs on Bright Data's infrastructure (no SIGKILL/OOM issues!).

## 📁 Files

| File | Purpose |
|------|---------|
| `scraper-studio-interaction.js` | **Interaction code** - Controls browser navigation and ad extraction |
| `scraper-studio-parser.js` | **Parser code** - Transforms raw data for your webhook |
| `scraper-studio-inputs.json` | All 2,014 Florida queries (JSON format) |
| `scraper-studio-inputs.csv` | All 2,014 Florida queries (CSV format) |
| `scraper-studio-inputs.ndjson` | All 2,014 Florida queries (NDJSON for API) |
| `generate-scraper-studio-config.ts` | Script to regenerate input files |

## 🚀 Setup Instructions

### Step 1: Open Scraper Studio

1. Go to: **https://brightdata.com/cp/ide**
2. Click **"New Scraper"**
3. Give it a name: `Meta-Ad-Library-Florida`

### Step 2: Paste Interaction Code

1. In the **"Interaction"** tab (left side):
2. Clear any existing code
3. Paste the contents of `scraper-studio-interaction.js`

```javascript
// This code:
// - Opens Meta Ad Library with your search term
// - Scrolls to load all ads
// - Extracts ad data using text-walking (proven working method)
// - Returns structured data
```

### Step 3: Paste Parser Code

1. In the **"Parser"** tab (right side):
2. Clear any existing code
3. Paste the contents of `scraper-studio-parser.js`

```javascript
// This code:
// - Transforms extracted data to Meta Ad Library API format
// - Adds your custom fields (keyword, location, priority)
// - Formats for your Supabase webhook
```

### Step 4: Configure Webhook

1. Click **"Settings"** (gear icon)
2. Find **"Webhook URL"**
3. Enter: `https://wirszszxsfcwvpdputhb.supabase.co/functions/v1/import-ads`
4. Set **"Format"**: `json`
5. Save settings

### Step 5: Upload Input Data

1. Click **"Inputs"** tab
2. Click **"Upload CSV"**
3. Select `scraper-studio-inputs.csv`
4. Verify the columns mapped correctly:
   - `keyword` → keyword
   - `location` → location
   - `priority` → priority
   - `category` → category

### Step 6: Test with 1 Query

1. Before running all 2,014 queries, test with 1:
2. Click **"Test"** button
3. Enter test input:
   ```json
   {
     "keyword": "golf cart",
     "location": "Ocala FL"
   }
   ```
4. Click **"Run Test"**
5. Verify results look correct

### Step 7: Run Full Batch

1. Click **"Run"** button
2. Select **"Batch Run"**
3. Choose all 2,014 inputs from the CSV
4. Set **"Concurrency"**: `5` (adjust based on your plan)
5. Click **"Start Batch"**

## 📊 What Happens

1. Bright Data spins up browsers in their cloud
2. Each browser opens Meta Ad Library with your search terms
3. Scrolls and extracts ads using text-walking
4. Sends results to your Supabase webhook
5. No SIGKILL - runs on Bright Data infrastructure!

## 🔍 Monitoring

- **Real-time logs**: Watch extraction progress
- **Results preview**: See ads as they're found
- **Webhook status**: Check delivery to Supabase
- **Error handling**: Failed queries auto-retry

## ⚙️ Configuration Options

### Adjust Scroll Depth
In `scraper-studio-interaction.js`, change:
```javascript
// Current: 5 scrolls
for (let i = 0; i < 5; i++) {

// More ads: Increase to 10
for (let i = 0; i < 10; i++) {
```

### Adjust Concurrency
In Scraper Studio settings:
- **Free plan**: 1-2 concurrent
- **Paid plan**: 5-10 concurrent (faster!)

### Add Retry Logic
The scraper already has basic retry. For more:
```javascript
// In interaction code, wrap in retry loop
for (let attempt = 0; attempt < 3; attempt++) {
  try {
    return await fetchData({ keyword, location });
  } catch (e) {
    if (attempt === 2) throw e;
    await new Promise(r => setTimeout(r, 5000));
  }
}
```

## 📈 Expected Results

| Metric | Estimate |
|--------|----------|
| Ads per query | 5-20 |
| Total ads (2,014 queries) | 10,000-40,000 |
| Time to complete | 4-8 hours |
| Success rate | 95%+ |
| Webhook delivery | Automatic |

## 🎯 Priority Order

The scraper processes queries by priority (P1 highest):

1. **P1**: Golf carts - Ocala (13 queries)
2. **P2**: Golf carts - The Villages (13 queries)
3. **P3**: Other dealerships - Ocala (10 queries)
4. **P4**: All services - Ocala (50 queries)
5. **P5**: Golf carts - FL State (34 queries)
6. **P6**: Medical spas - FL State (72 queries)
7. **P7**: HVAC - FL State (72 queries)
8. **P8**: All services - FL State (1,750 queries)

## 🔧 Troubleshooting

### No ads found
- Check Meta Ad Library manually for that keyword/location
- Increase scroll depth
- Check if location needs to be formatted differently

### Webhook errors
- Verify webhook URL is correct
- Check Supabase `import-ads` function logs
- Test webhook with curl first

### Timeout errors
- Meta Ad Library might be slow - increase timeout in interaction code
- Reduce concurrency
- Check Bright Data status

## 💡 Alternative: API Trigger

Instead of using the UI, you can trigger via API:

```bash
curl -X POST "https://api.brightdata.com/scrapers/run" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "scraper_id": "YOUR_SCRAPER_ID",
    "inputs": @scraper-studio-inputs.ndjson,
    "webhook": "https://wirszszxsfcwvpdputhb.supabase.co/functions/v1/import-ads"
  }'
```

## ✅ Benefits Over VPS

| Feature | VPS + Puppeteer | Scraper Studio |
|---------|-----------------|----------------|
| SIGKILL/OOM | ❌ Constant issue | ✅ None - runs on BD infra |
| Browser management | ❌ Your problem | ✅ BD manages |
| Proxy rotation | ❌ Manual | ✅ Built-in |
| Scaling | ❌ Limited by RAM | ✅ Auto-scales |
| Monitoring | ❌ Self-built | ✅ Built-in dashboard |
| Cost | ❌ VPS + Bandwidth | ✅ Pay per request |

## 🎉 Success!

Once running, your Supabase database will fill with Florida ads automatically. No more SIGKILL, no more babysitting the scraper!

**Questions?** Check Bright Data docs: https://docs.brightdata.com/scrapers/scraper-studio
