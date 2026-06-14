
import puppeteer from 'puppeteer';

async function performSearch(query: string) {
    console.log(`[BROWSER] Launching search for: ${query}`);
    const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
    const page = await browser.newPage();
    
    // Google search
    await page.goto(`https://www.google.com/search?q=${encodeURIComponent(query)}`);
    
    // Extract results (simplified demo logic)
    const results = await page.evaluate(() => {
        const elements = document.querySelectorAll('h3');
        return Array.from(elements).map(e => e.innerText).slice(0, 3);
    });
    
    await browser.close();
    return results;
}

const args = process.argv.slice(2);
const data = JSON.parse(args.find(a => a.startsWith('--data='))?.split('=')[1] || '{}');

if (data.query) {
    performSearch(data.query).then(res => {
        console.log(JSON.stringify(res));
    });
}
