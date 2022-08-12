const puppeteer = require("puppeteer");
const axios = require("axios").default;
const fs = require("fs");
const path = require("path");

const baseUrl = "https://qlik.dev";
const downloadPath = path.resolve(`${process.cwd()}/data`);

const saveRawData = false;

async function scrape() {
  //   await downloadQixData();
  await downloadSaaSData();
  //   await downloadNebulaData();
}

scrape();

function combineFiles(rawData) {
  const info = {};
  const combined = rawData.map((a) => {
    info[a.title] = a.specData.info;
    return {
      paths: a.specData.paths,
      definitions: a.specData.components.schemas,
    };
  });

  const flatten = {
    swagger: "2.0",
    info: {
      title: "Open API specification for Qlik SaaS REST API",
    },
    paths: {},
    definitions: {},
  };

  for (let area of combined) {
    for (let [path, data] of Object.entries(area.paths)) {
      flatten.paths[path] = data;
    }

    for (let [path, data] of Object.entries(area.definitions)) {
      flatten.definitions[path] = data;
    }
  }

  fs.writeFileSync(
    `${process.cwd()}/data/SaaS_infos.json`,
    JSON.stringify(info, null, 4)
  );
  fs.writeFileSync(
    `${process.cwd()}/data/SaaS_Swagger_Data.json`,
    JSON.stringify(flatten, null, 4)
  );
}

async function downloadQixData() {
  const qixData = await axios
    .get(`${baseUrl}/specs/openRPC/engine-rpc.json`)
    .then((r) => r.data);

  fs.writeFileSync(
    `${process.cwd()}/data/QIX_data.json`,
    JSON.stringify(qixData, null, 4)
  );
}

async function downloadSaaSData() {
  const browser = await puppeteer.launch({});
  const page = await browser.newPage();

  await page.goto(`${baseUrl}/apis#rest`, { waitUntil: "load" });

  const areasAll = await page.$$eval(`.endpoint`, (nodes) =>
    nodes.map((element) => {
      const title = element
        .querySelector("div > h3")
        .innerText.replace("# ", "");

      const referenceLink = element
        .querySelector("div > div > a")
        .getAttribute("href");

      return {
        title,
        referenceLink,
      };
    })
  );

  const areasRest = areasAll.filter(
    (a) => a.referenceLink.indexOf("/apis/rest/") > -1
  );

  let data = [];

  for (let [index, area] of areasRest.entries()) {
    await page.goto(`${baseUrl}${area.referenceLink}`, {
      waitUntil: "load",
    });

    const downloadLinks = await page.$$eval(
      `[data-testid="entity-download-spec"]`,
      (elements) =>
        elements.map((element) => {
          return element.getAttribute("href");
        })
    );
    const specLink = `${baseUrl}${downloadLinks[0]}`;

    const specData = await axios.get(specLink).then((r) => r.data);

    data.push({
      ...area,
      specLink,
      specData,
    });

    console.log(
      `${index + 1}/${areasRest.length} ${area.title} --> ${
        area.referenceLink
      } `
    );
  }

  await page.close();
  await browser.close();

  if (saveRawData)
    fs.writeFileSync(
      `${process.cwd()}/data/SaaS_raw_data.json`,
      JSON.stringify(data, null, 4)
    );

  combineFiles(data);
}

async function downloadNebulaData() {
  const browser = await puppeteer.launch({ headless: false });
  const page = await browser.newPage();

  await page.goto(`${baseUrl}/apis/javascript/nebula-bar-chart`, {
    waitUntil: "load",
  });

  await page._client.send("Page.setDownloadBehavior", {
    behavior: "allow",
    downloadPath: downloadPath,
  });
  await page.click(".download-link");

  await page.close();
  await browser.close();
}
