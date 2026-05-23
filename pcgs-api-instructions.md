# PCGS Public API Instructions

## Overview

This document describes the PCGS public API endpoints, parameters, and response shapes. The API exposes data for graded **coins** (CoinFacts, auction prices, images), **banknotes**, and **orders/submissions** tied to your PCGS account.

All responses are `application/json`.

---

## Authentication

The API uses a **public API token** for authentication. You must generate your token from your PCGS API account page and include it in the request.

When testing via the PCGS interactive docs page, paste your token into the `token` textbox.

> Treat the token like a password. Do not commit it to source control or expose it in client-side code.

---

## Endpoint Index

### Banknotes
- `GET /banknotedetail/GetBanknoteByCertNo`
- `GET /banknotedetail/GetBanknoteByGrade`
- `GET /banknotedetail/GetBanknoteImagesByCertNo`

### Orders
- `GET /orderdetail/GetOrdersBySubmissionNo`
- `GET /orderdetail/GetOrdersByDateRange`

### Coins (CoinFacts, APR, Images)
- `GET /coindetail/GetCoinFactsByCertNo/{certNo}`
- `GET /coindetail/GetCoinFactsByBarcode`
- `GET /coindetail/GetCoinFactsByGrade`
- `GET /coindetail/GetAPRByCertNo/{CertNo}`
- `GET /coindetail/GetAPRByGrade`
- `GET /coindetail/GetAPRByBarcode`
- `GET /coindetail/GetImagesByCertNo`

---

## Banknote Endpoints

### GET `/banknotedetail/GetBanknoteByCertNo`

Get banknote details by certificate number.

**Query Parameters**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `certNo` | string | Yes | The PCGS certificate number |
| `languageCode` | string | No | Language code |

**Response (200)**

```json
{
  "Banknote": {
    "PCGSNo": "string",
    "CertNo": "string",
    "Year": "string",
    "Denomination": "string",
    "Region": "string",
    "Grade": "string",
    "Details": "string",
    "Population": 0,
    "PopHigher": 0,
    "SerialNo": "string",
    "Height": "string",
    "Width": "string",
    "Images": [
      {
        "Label": "string",
        "ThumbnailUrl": "string",
        "PopupUrl": "string",
        "Width": 0,
        "Height": 0,
        "ImageDescription": "string"
      }
    ],
    "CatalogNo1": "string",
    "CatalogNo2": "string",
    "Catalog1LongDesc": "string",
    "Catalog2LongDesc": "string",
    "Catalog1ShortDesc": "string",
    "Catalog2ShortDesc": "string",
    "Signers": "string",
    "Qualifiers": "string",
    "PlateNo": "string",
    "ValueViewLink": "string",
    "HasObverseImage": true,
    "HasReverseImage": true,
    "ImageReady": true
  },
  "IsValidRequest": true,
  "ServerMessage": "string"
}
```

---

### GET `/banknotedetail/GetBanknoteByGrade`

Get banknote details by PCGS spec number and grade.

**Query Parameters**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `pcgsNo` | string | Yes | The PCGS Spec No |
| `gradeNo` | integer | Yes | The PCGS grade |

**Response (200)** — returns an array `Banknotes[]` with the same item shape as `GetBanknoteByCertNo`.

---

### GET `/banknotedetail/GetBanknoteImagesByCertNo`

Get all available images for a banknote by certificate number.

**Query Parameters**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `certNo` | string | Yes | The PCGS certificate number |

**Response (200)**

```json
{
  "CertNo": "string",
  "Images": [
    {
      "Url": "string",
      "Resolution": "string",
      "Description": "string"
    }
  ],
  "HasObverseImage": true,
  "HasReverseImage": true,
  "HasTrueViewImage": true,
  "ImageReady": true,
  "IsValidRequest": true,
  "ServerMessage": "string"
}
```

---

## Order Endpoints

These return orders tied to the PCGS account used to register for the API.

### GET `/orderdetail/GetOrdersBySubmissionNo`

Get PCGS orders by submission number. A single submission number may map to multiple orders if it has been submitted more than once.

**Query Parameters**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `submissionNo` | string | Yes | The submission number |

**Response (200)**

```json
{
  "Orders": [
    {
      "SubmissionNo": "string",
      "OrderNo": "string",
      "CustomerNo": "string",
      "ItemCount": 0,
      "Service": "string",
      "OrderStatus": "string",
      "DateReceived": "string",
      "DateShipped": "string",
      "Courier": "string",
      "TrackingNo": "string",
      "TrackingUrl": "string",
      "IsCancelled": true,
      "ImageInProcess": true,
      "ImageReady": true,
      "GradeReady": true,
      "OrderLines": [
        {
          "LineNo": 0,
          "ItemNo": 0,
          "CertNo": "string",
          "PCGSNo": "string",
          "Description": "string",
          "DisplayGrade": "string",
          "Country": "string",
          "Images": ["string"]
        }
      ]
    }
  ],
  "IsValidRequest": true,
  "ServerMessage": "string"
}
```

---

### GET `/orderdetail/GetOrdersByDateRange`

Get PCGS orders within a date range, filtered by the order's **received** date.

**Query Parameters**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `startDate` | string | Yes | Start date in `mm-dd-yyyy` format |
| `endDate` | string | Yes | End date in `mm-dd-yyyy` format |
| `pageNo` | integer | No | Page number to return |
| `pageSize` | integer | No | Orders per page (default `10`) |

**Response (200)** — same shape as `GetOrdersBySubmissionNo`.

---

## Coin Endpoints

### GET `/coindetail/GetCoinFactsByCertNo/{certNo}`

Get full CoinFacts data for a coin by cert number.

**Path / Query Parameters**

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `certNo` | path | string | Yes | The PCGS cert number |
| `retrieveAllData` | query | boolean | No | Default `true`. Set `false` to exclude APR, Pop, Images, and Prices |

**Response (200)**

```json
{
  "PCGSNo": "string",
  "CertNo": "string",
  "Name": "string",
  "Year": 0,
  "Denomination": "string",
  "Mintage": "string",
  "MintMark": "string",
  "MintLocation": "string",
  "MetalContent": "string",
  "Diameter": 0,
  "Edge": "string",
  "Weight": 0,
  "Country": "string",
  "Grade": "string",
  "Designation": "string",
  "PriceGuideValue": 0,
  "Population": 0,
  "PopHigher": 0,
  "CoinFactsLink": "string",
  "Designer": "string",
  "Images": [
    { "Thumbnail": "string", "Fullsize": "string" }
  ],
  "CoinFactsNotes": "string",
  "MajorVariety": "string",
  "MinorVariety": "string",
  "DieVariety": "string",
  "AuctionList": [
    {
      "Service": "string",
      "Date": "string",
      "Auctioneer": "string",
      "LotNo": 0,
      "LotNumV2": "string",
      "SaleName": "string",
      "CertNo": "string",
      "Price": 0,
      "IsCAC": true,
      "AuctionLotUrl": "string"
    }
  ],
  "SeriesName": "string",
  "Category": "string",
  "HasTrueViewImage": true,
  "ImageReady": true,
  "IsNFCSecure": true,
  "IsValidRequest": true,
  "ServerMessage": "string"
}
```

---

### GET `/coindetail/GetCoinFactsByBarcode`

Get CoinFacts data using the barcode printed on a holder.

**Query Parameters**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `barcode` | string | Yes | Barcode text captured from a PCGS or NGC holder |
| `gradingService` | string | Yes | `PCGS` or `NGC` |

**Response (200)** — same shape as `GetCoinFactsByCertNo`, with additional `HasObverseImage` / `HasReverseImage` flags.

---

### GET `/coindetail/GetCoinFactsByGrade`

Get CoinFacts data by PCGS number and grade.

**Query Parameters**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `PCGSNo` | string | Yes | The PCGS number of the coin |
| `GradeNo` | integer | Yes | The grade number |
| `PlusGrade` | boolean | No | `true` if a plus grade, otherwise `false` |

**Response (200)** — same shape as `GetCoinFactsByCertNo` (without the image/NFC-only flags).

---

### GET `/coindetail/GetAPRByCertNo/{CertNo}`

Get Auction Prices Realized (APR) data for a coin by cert number.

**Path Parameters**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `CertNo` | string | Yes | The PCGS cert number |

**Response (200)**

```json
{
  "PCGSNo": "string",
  "CertNo": "string",
  "Name": "string",
  "Grade": "string",
  "Year": "string",
  "Denomination": "string",
  "Auctions": [
    {
      "Service": "string",
      "Date": "string",
      "Auctioneer": "string",
      "LotNo": 0,
      "LotNumV2": "string",
      "SaleName": "string",
      "CertNo": "string",
      "Price": 0,
      "IsCAC": true,
      "AuctionLotUrl": "string"
    }
  ],
  "IsValidRequest": true,
  "ServerMessage": "string"
}
```

---

### GET `/coindetail/GetAPRByGrade`

Get APR data by PCGS number and grade, with optional date range and result count.

**Query Parameters**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `PCGSNo` | string | Yes | The PCGS number of the coin |
| `GradeNo` | integer | Yes | The grade number |
| `PlusGrade` | boolean | No | `true` if a plus grade |
| `StartDate` | date-time | No | Starting auction date in `mm-dd-yyyy` format |
| `EndDate` | date-time | No | Ending auction date in `mm-dd-yyyy` format |
| `NumberOfRecords` | integer | No | How many auction records to return (default `100`) |

**Response (200)** — same shape as `GetAPRByCertNo` (without `CertNo` / `Grade` at the top level).

---

### GET `/coindetail/GetAPRByBarcode`

Get APR data using the holder's barcode.

**Query Parameters**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `barcode` | string | Yes | Barcode text from a PCGS or NGC holder |
| `gradingService` | string | Yes | `PCGS` or `NGC` |
| `StartDate` | date-time | No | Starting auction date in `mm-dd-yyyy` format |
| `EndDate` | date-time | No | Ending auction date in `mm-dd-yyyy` format |

**Response (200)** — same shape as `GetCoinFactsByCertNo` (includes the embedded `AuctionList`).

---

### GET `/coindetail/GetImagesByCertNo`

Get all PCGS images available for a coin's certification number.

**Query Parameters**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `certNo` | string | Yes | The PCGS certificate number |

**Response (200)**

```json
{
  "CertNo": "string",
  "Images": [
    {
      "Url": "string",
      "Resolution": "string",
      "Description": "string"
    }
  ],
  "HasObverseImage": true,
  "HasReverseImage": true,
  "HasTrueViewImage": true,
  "ImageReady": true,
  "IsValidRequest": true,
  "ServerMessage": "string"
}
```

---

## Common Response Fields

Most endpoints include the following at the top level of the response:

| Field | Type | Meaning |
|-------|------|---------|
| `IsValidRequest` | boolean | `true` if the request was valid and processed |
| `ServerMessage` | string | Error or status message from the server |
| `ImageReady` | boolean | Whether image data is ready for the item |
| `HasObverseImage` / `HasReverseImage` / `HasTrueViewImage` | boolean | Image availability flags |

---

## Date Format Reference

All date inputs use **`mm-dd-yyyy`** (e.g., `05-23-2026`). Output dates returned by the API are strings; parse them defensively rather than assuming a fixed format.

---

## Quick-Reference Lookup Patterns

| If you have... | Use this endpoint |
|---|---|
| A coin cert number | `GetCoinFactsByCertNo/{certNo}` |
| A coin holder barcode (PCGS or NGC) | `GetCoinFactsByBarcode` |
| A PCGS number + grade | `GetCoinFactsByGrade` |
| A submission number | `GetOrdersBySubmissionNo` |
| A date window of received orders | `GetOrdersByDateRange` |
| A banknote cert number | `GetBanknoteByCertNo` |
| Auction history for a specific coin | `GetAPRByCertNo` / `GetAPRByGrade` / `GetAPRByBarcode` |
| Just images for a cert | `GetImagesByCertNo` (coin) or `GetBanknoteImagesByCertNo` (banknote) |
