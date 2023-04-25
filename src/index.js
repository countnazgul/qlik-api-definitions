import dotenv from "dotenv";
dotenv.config();

import path from "path";
import { Agent } from "https";
import { readFileSync, writeFileSync } from "fs";
import puppeteer from "puppeteer";
import axios from "axios";
import { QlikProxyClient, QlikRepositoryClient } from "qlik-rest-api";

const baseUrl = "https://qlik.dev";
const downloadPath = path.resolve(`${process.cwd()}/data`);

const saveRawData = false;

async function scrape() {
  if (!process.argv.includes["--saas"]) {
    await downloadQixData();
    await downloadSaaSData();
    // await downloadNebulaData();

    if (`${process.env.EXTRACT_ENTERPRISE}` == "yes") {
      await downloadRepoData();
      await downloadProxyData();
    }
  } else {
    await downloadSaaSData();
  }
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

  writeFileSync(
    `${process.cwd()}/data/SaaS_infos.json`,
    JSON.stringify(info, null, 4)
  );
  writeFileSync(
    `${process.cwd()}/data/SaaS_Swagger_Data.json`,
    JSON.stringify(flatten, null, 4)
  );
}

async function downloadQixData() {
  const qixData = await axios
    .get(`${baseUrl}/specs/openRPC/engine-rpc.json`)
    .then((r) => r.data);

  writeFileSync(
    `${process.cwd()}/data/QIX_data.json`,
    JSON.stringify(qixData, null, 4)
  );

  console.log(`1/1 QIX --> ${baseUrl}/specs/openRPC/engine-rpc.json`);
}

async function downloadSaaSData() {
  const browser = await puppeteer.launch({
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
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
    writeFileSync(
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

async function downloadProxyData() {
  const cert = readFileSync(`${process.env.CERT_LOCATION}/client.pem`);
  const key = readFileSync(`${process.env.CERT_LOCATION}/client_key.pem`);

  const proxyClient = new QlikProxyClient({
    host: `${process.env.QLIK_LOCAL_HOST}`,
    port: 4243,
    httpsAgent: new Agent({
      rejectUnauthorized: false,
      cert,
      key,
    }),
    authentication: {
      user_dir: `${process.env.USER_DIR}`,
      user_name: `${process.env.USER_ID}`,
    },
  });

  console.log(
    `1/1 PROXY --> ${process.env.QLIK_LOCAL_HOST}/about/openapi/main`
  );

  const data = await proxyClient.Get(`about/openapi/main`);
  writeFileSync(
    `${process.cwd()}/data/Proxy.json`,
    JSON.stringify(data, null, 4)
  );
}

async function downloadRepoData() {
  const cert = readFileSync(`${process.env.CERT_LOCATION}/client.pem`);
  const key = readFileSync(`${process.env.CERT_LOCATION}/client_key.pem`);

  const repoClient = new QlikRepositoryClient({
    host: `${process.env.QLIK_LOCAL_HOST}`,
    port: 4242,
    httpsAgent: new Agent({
      rejectUnauthorized: false,
      cert,
      key,
    }),
    authentication: {
      user_dir: `${process.env.USER_DIR}`,
      user_name: `${process.env.USER_ID}`,
    },
  });

  console.log(`1/1 REPO --> ${process.env.QLIK_LOCAL_HOST}/about/openapi/main`);
  const data = await repoClient.Get(`about/openapi/main`);

  writeFileSync(
    `${process.cwd()}/data/Repository.json`,
    JSON.stringify(data, null, 4)
  );
}
