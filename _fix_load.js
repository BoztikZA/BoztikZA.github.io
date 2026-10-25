const fs = require('fs');
const p = 'd:/Boztik Website/deliver-v3/js/site-analytics.js';
let s = fs.readFileSync(p, 'utf8');

const oldBlock = `  let pageFlow = [];
  let storeResult = null, storeFailure = null;
  storeClickLoading = true;

  renderStoreClicks();
  const storeRequest = fetchStoreClickSummary(periodKey).then(value => { storeResult = value; }).catch(error => { storeFailure = error; });
  try {
    summary = await fetchAnalyticsSummary(periodKey);
  } catch (error) {
    failure = error;
    // Worker not updated yet (404) or summary failed: keep the page useful with the older fixed-30-day page views.
    try { fallback = (await fetchPageAnalytics()).pages; } catch { /* reported below */ }
  }
  try {
    pageFlow = (await fetchPageFlow(flowDaysForPeriod(periodKey))).paths || [];
  } catch {
    pageFlow = [];
  }
  await storeRequest;
  if (mine !== loadSeq) return; // a newer period was picked while this was loading
  storeClickSummary = storeResult;
  storeClickFailure = storeFailure;
  storeClickLoading = false;

  if (!summary && !fallback) {`;

const newBlock = `  let pageFlow = [];
  let websiteTimeseriesResult = null, websiteTimeseriesFailure = null;
  websiteTimeseriesLoading = true;
  let storeResult = null, storeFailure = null;
  storeClickLoading = true;

  renderStoreClicks();
  const storeRequest = fetchStoreClickSummary(periodKey).then(value => { storeResult = value; }).catch(error => { storeFailure = error; });
  try {
    summary = await fetchAnalyticsSummary(periodKey);
  } catch (error) {
    failure = error;
    try { fallback = (await fetchPageAnalytics()).pages; } catch { /* reported below */ }
  }
  try {
    pageFlow = (await fetchPageFlow(flowDaysForPeriod(periodKey))).paths || [];
  } catch {
    pageFlow = [];
  }
  try {
    const days = flowDaysForPeriod(periodKey);
    websiteTimeseriesResult = (await fetchWebsiteTimeseries(days)).series || [];
  } catch {
    websiteTimeseriesResult = [];
    websiteTimeseriesFailure = true;
  }
  await storeRequest;
  if (mine !== loadSeq) return; // a newer period was picked while this was loading
  storeClickSummary = storeResult;
  storeClickFailure = storeFailure;
  storeClickLoading = false;
  websiteTimeseries = websiteTimeseriesResult;
  websiteTimeseriesLoading = false;

  if (!summary && !fallback) {`;

const sLf = s.replace(/\r\n/g, '\n');
if (sLf.includes(oldBlock)) {
  const s2 = sLf.replace(oldBlock, newBlock);
  fs.writeFileSync(p, s2.replace(/\n/g, '\r\n'));
  console.log('replaced load() block');
} else {
  console.log('OLD BLOCK NOT FOUND');
  const idx = sLf.indexOf('let pageFlow = [];');
  console.log('at index', idx);
  console.log(JSON.stringify(sLf.substring(idx, idx + 200)));
}