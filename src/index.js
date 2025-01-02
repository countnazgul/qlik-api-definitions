import dotenv from "dotenv";
dotenv.config();

import path from "path";
import { Agent } from "https";
import { readFileSync, writeFileSync } from "fs";
import puppeteer from "puppeteer";
import axios from "axios";
import { QlikProxyClient, QlikRepositoryClient } from "qlik-rest-api";
// import SwaggerParser from "@apidevtools/swagger-parser";

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

    let d = {
      paths: a.specData.paths,
      components: {},
    };

    if (a.specData.components) {
      if (a.specData.components.schemas)
        d.components.schemas = a.specData.components.schemas;

      if (a.specData.components.errors)
        d.components.schemas = a.specData.components.errors;

      if (a.specData.components.requestBodies)
        d.components.requestBodies = a.specData.components.requestBodies;

      if (a.specData.components.responses)
        d.components.responses = a.specData.components.responses;

      if (a.specData.components.parameters)
        d.components.parameters = a.specData.components.parameters;

      if (a.specData.components.headers)
        d.components.headers = a.specData.components.headers;

      if (a.specData.components.examples)
        d.components.examples = a.specData.components.examples;
    }

    return d;
  });

  const flatten = {
    swagger: "2.0",
    info: {
      title: "Open API specification for Qlik SaaS REST API",
    },
    paths: {},
    components: {},
  };

  for (let area of combined) {
    for (let [path, data] of Object.entries(area.paths)) {
      // force add apps tag for all /v1/apps endpoints that
      // do not have tags defined. For some reason the only endpoints
      // without tags are the /v1/apps
      if (path.indexOf("/v1/apps") > -1) {
        if (data["get"] && !data["get"].tags) data["get"].tags = ["apps"];
        if (data["post"] && !data["post"].tags) data["post"].tags = ["apps"];
        if (data["put"] && !data["put"].tags) data["put"].tags = ["apps"];
        if (data["patch"] && !data["patch"].tags) data["patch"].tags = ["apps"];
        if (data["delete"] && !data["delete"].tags)
          data["delete"].tags = ["apps"];
      }

      flatten.paths[path] = data;
    }

    for (let [path, data] of Object.entries(area.components)) {
      flatten.components[path] = { ...flatten.components[path], ...data };
    }
  }

  flatten.paths = Object.fromEntries(Object.entries(flatten.paths).sort());

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
    .get(`${baseUrl}/specs/json-rpc/qix.json`)
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
    headless: "new",
  });
  const page = await browser.newPage();

  await page.setViewport({
    width: 1280,
    height: 960,
    deviceScaleFactor: 1,
  });

  await page.goto(`${baseUrl}/apis/rest`, { waitUntil: "load" });

  try {
    await page.click("#onetrust-accept-btn-handler");
  } catch (e) { }

  const areasAll = await page.$$eval(`.category-overview-card`, (nodes) =>
    nodes.map((element) => {
      const title = element
        .querySelector("h3")
        .innerText.replace("# ", "");

      const referenceLink = element
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
      waitUntil: "networkidle0",
    });

    try {
      await page.click("#onetrust-accept-btn-handler");
    } catch (e) { }

    const downloadLinks = await page.$$eval(".download-link", (elements) =>
      elements.map((element) => element.getAttribute("href"))
    );
    const specLink = `${baseUrl}${downloadLinks[0]}`;

    const specData = await axios.get(specLink).then((r) => r.data);

    data.push({
      ...area,
      specLink,
      specData,
    });

    console.log(
      `${index + 1}/${areasRest.length} ${area.title} --> ${area.referenceLink
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
  const browser = await puppeteer.launch({ headless: "new" });
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
    host: `${process.env.QLIK_HOST}`,
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

  console.log(`1/1 PROXY --> ${process.env.QLIK_HOST}/about/openapi/main`);

  const data = await proxyClient.Get(`about/openapi/main`);
  writeFileSync(
    `${process.cwd()}/data/Proxy.json`,
    JSON.stringify(data.data, null, 4)
  );
}

async function downloadRepoData() {
  const cert = readFileSync(`${process.env.CERT_LOCATION}/client.pem`);
  const key = readFileSync(`${process.env.CERT_LOCATION}/client_key.pem`);

  const repoClient = new QlikRepositoryClient({
    host: `${process.env.QLIK_HOST}`,
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

  console.log(`1/1 REPO --> ${process.env.QLIK_HOST}/about/openapi/main`);
  const data = await repoClient.Get(`about/openapi/main`);

  writeFileSync(
    `${process.cwd()}/data/Repository.json`,
    JSON.stringify(data.data, null, 4)
  );
}

// async function validate() {
//   try {
//     const myAPI = readFileSync(`${process.cwd()}/data/SaaS_Swagger_Data.json`);
//     let api = await SwaggerParser.validate(JSON.parse(myAPI));

//     console.log("API name: %s, Version: %s", api.info.title, api.info.version);
//   } catch (err) {
//     console.error(err);
//   }
// }

// validate();
