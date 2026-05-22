# CDN Public Collector's Pricing Guide (CPG) API V2

**Version:** 1.0
**OAS:** 2.0
**Base URL:** `cpgpublicapiv2beta.greysheet.com/`
**Schemes:** `https`
**OpenAPI spec:** `/openapi`

---

## Authentication

All requests require the following headers:

| Header | Description |
|---|---|
| `x-api-key` | Your API key |
| `x-api-token` | Your API token |
| `Accept` | `application/json` |

---

## Table of Contents

- [Catalog](#catalog)
  - [GET /GetNodeRequest](#get-getnoderequest)
  - [GET /GetNodeChildrenRequest](#get-getnodechildrenrequest)
  - [GET /GetCollectibleRequest](#get-getcollectiblerequest)
  - [GET /GetCollectibleByNodeRequest](#get-getcollectiblebynoderequest)
- [Pricing](#pricing)
  - [GET /GetPricingRequest](#get-getpricingrequest)
- [Models](#models)
  - [NodeResponse](#noderesponse)
  - [Node](#node)
  - [CollectibleResponse](#collectibleresponse)
  - [Collectible](#collectible)
  - [PricingResponse](#pricingresponse)
  - [PricingItem](#pricingitem)
  - [PricingData](#pricingdata)
  - [Common Response Envelope Fields](#common-response-envelope-fields)

---

# Catalog

## GET `/GetNodeRequest`

**Retrieve a node.**

When `NodeChildrenCountLive > 0` then this is a leaf node and has Node children. If `CollectibleChildrenCountLive > 0` then the node has collectible children. There is no Advanced API version for this call.

### Parameters

| Name | In | Type | Required | Description |
|---|---|---|---|---|
| `NodeId` | query | integer ($int64) | — | NodeId |
| `Accept` | header | string | yes | Accept Header. Available values: `application/json` |

### Responses

| Code | Description |
|---|---|
| 200 | Success — returns a [NodeResponse](#noderesponse) |

**Response content type:** `application/json`

### Example response

```json
{
  "Data": [
    {
      "Id": 0,
      "Name": "string",
      "Description": "string",
      "FeaturedImageUrl": "string",
      "FeaturedImageAttribution": "string",
      "FlagCode": "string",
      "CountryName": "string",
      "SortingPosition": 0,
      "NodeChildrenCountLive": 0,
      "CollectibleChildrenCountLive": 0,
      "ParentNode_Id": 0,
      "RootNode_Id": 0,
      "ChildNodes": [
        "string"
      ]
    }
  ],
  "Total": 0,
  "OpCode": 0,
  "ErrorText": "string",
  "RequestTime": "string",
  "ResponseTime": "string",
  "TotalExecutionTime": "string",
  "CachedResponse": true,
  "PermitAccess": true,
  "AccessDeniedMessage": "string"
}
```

---

## GET `/GetNodeChildrenRequest`

**Retrieve node children for a given node.**

This will return no data for those nodes with collectible children. There is no Advanced API version for this call.

### Parameters

| Name | In | Type | Required | Description |
|---|---|---|---|---|
| `NodeId` | query | integer ($int64) | — | NodeId |
| `Accept` | header | string | yes | Accept Header. Available values: `application/json` |

### Responses

| Code | Description |
|---|---|
| 200 | Success — returns a [NodeResponse](#noderesponse) |

**Response content type:** `application/json`

### Example response

```json
{
  "Data": [
    {
      "Id": 0,
      "Name": "string",
      "Description": "string",
      "FeaturedImageUrl": "string",
      "FeaturedImageAttribution": "string",
      "FlagCode": "string",
      "CountryName": "string",
      "SortingPosition": 0,
      "NodeChildrenCountLive": 0,
      "CollectibleChildrenCountLive": 0,
      "ParentNode_Id": 0,
      "RootNode_Id": 0,
      "ChildNodes": [
        "string"
      ]
    }
  ],
  "Total": 0,
  "OpCode": 0,
  "ErrorText": "string",
  "RequestTime": "string",
  "ResponseTime": "string",
  "TotalExecutionTime": "string",
  "CachedResponse": true,
  "PermitAccess": true,
  "AccessDeniedMessage": "string"
}
```

---

## GET `/GetCollectibleRequest`

**Retrieve collectible(s).**

Specify `ApiLevel=Advanced` for additional collectible information.

### Parameters

| Name | In | Type | Required | Description |
|---|---|---|---|---|
| `GsId` | query | integer ($int64) | — | GsId |
| `ApiLevel` | query | string | — | `Advanced` for additional fields |
| `Accept` | header | string | yes | Accept Header. Available values: `application/json` |

### Responses

| Code | Description |
|---|---|
| 200 | Success — returns a [CollectibleResponse](#collectibleresponse) |

**Response content type:** `application/json`

### Example response

```json
{
  "Data": [
    {
      "Gsid": 0,
      "UiParentId": 0,
      "Name": "string",
      "PcgsNumber": "string",
      "FriedbergNumber": "string",
      "CoinDate": "string",
      "DenominationShort": "string",
      "DenominationLong": "string",
      "Variety": "string",
      "Variety2": "string",
      "Desg": "string",
      "Other": "string",
      "Prefix": "string",
      "MintMark": "string",
      "Composition": "string",
      "Mintage": "string",
      "StrikeType": "string",
      "Diameter": "string",
      "Fineness": "string",
      "WeightGrams": 0,
      "WeightOunces": 0,
      "Designer": "string",
      "Edge": "string",
      "Rarity": "string",
      "CoinShape": "string",
      "Description": "string",
      "GeneralNotes": "string",
      "GeneralNotesSource": "string",
      "GeneralCoinLettering": "string",
      "ObverseDescription": "string",
      "ObverseDesigner": "string",
      "ObverseLettering": "string",
      "ReverseDescription": "string",
      "ReverseDesigner": "string",
      "ReverseLettering": "string",
      "BnBNumber": "string",
      "NoteColor": "string",
      "NoteDimension": "string",
      "PickNumber": "string",
      "Watermark": "string",
      "Printer": "string",
      "NoteSecurityThread": "string",
      "NotePaperType": "string",
      "BnbSignatureName1": "string",
      "BnbSignatureName2": "string",
      "BnbSignatureName3": "string",
      "ObsoleteBankId": "string",
      "ObsoleteStateName": "string",
      "ObsoleteCityName": "string",
      "ObsoleteBankName": "string",
      "HaxbyNumber": "string",
      "BnbTitle": "string",
      "IssueNumber": "string",
      "IssueMonth": 0,
      "IssueYear": 0,
      "Variant": "string",
      "ArtComment1": "string",
      "ArtComment2": "string",
      "ArtComment3": "string",
      "KeyComment1": "string",
      "KeyComment2": "string",
      "KeyComment3": "string",
      "Ngc": "string",
      "NgcId": 0,
      "Krause": "string",
      "EbayCategory1": 0,
      "FeaturedImageUrl": "string",
      "FeaturedImageAttribution": "string",
      "IsType": true,
      "IsSet": true,
      "PriceLow": 0,
      "PriceHigh": 0,
      "Is100GreatestUSCoins": 0,
      "Is100GreatestUSPaperMoney": 0,
      "Is100GreatestWorldPaperMoney": 0,
      "Is100GreatestModernUsCoins": 0,
      "IsRedbook": true,
      "IsCherryPicker": true,
      "RootNode_Id": 0,
      "ParentNode_Id": 0,
      "ParentNodeName": "string",
      "SortingPosition": 0,
      "CatalogPath": [
        {
          "Id": 0,
          "Name": "string",
          "Description": "string",
          "FeaturedImageUrl": "string",
          "FeaturedImageAttribution": "string",
          "FlagCode": "string",
          "CountryName": "string",
          "SortingPosition": 0,
          "NodeChildrenCountLive": 0,
          "CollectibleChildrenCountLive": 0,
          "ParentNode_Id": 0,
          "RootNode_Id": 0,
          "ChildNodes": [
            "string"
          ]
        }
      ]
    }
  ],
  "Total": 0,
  "OpCode": 0,
  "ErrorText": "string",
  "RequestTime": "string",
  "ResponseTime": "string",
  "TotalExecutionTime": "string",
  "CachedResponse": true,
  "PermitAccess": true,
  "AccessDeniedMessage": "string"
}
```

---

## GET `/GetCollectibleByNodeRequest`

**Get all collectibles for a given Node.**

Specify `ApiLevel=Advanced` for additional collectible information.

### Parameters

| Name | In | Type | Required | Description |
|---|---|---|---|---|
| `NodeId` | query | integer ($int64) | — | NodeId |
| `ApiLevel` | query | string | — | `Advanced` for additional fields |
| `Accept` | header | string | yes | Accept Header. Available values: `application/json` |

### Responses

| Code | Description |
|---|---|
| 200 | Success — returns a [CollectibleResponse](#collectibleresponse) |

**Response content type:** `application/json`

### Example response

Identical schema to [GET /GetCollectibleRequest](#get-getcollectiblerequest). See that section for the full example payload.

---

# Pricing

## GET `/GetPricingRequest`

**Retrieve pricing data for a collectible.**

`Gsid` or `PcgsNumber` is required. `Grade`, `MinGrade` and `MaxGrade` are optional. Specify `ApiLevel=Advanced` for additional collectible information.

### Parameters

| Name | In | Type | Required | Description |
|---|---|---|---|---|
| `Gsid` | query | integer ($int64) | one of `Gsid` / `PcgsNumber` required | Gsid |
| `PcgsNumber` | query | string | one of `Gsid` / `PcgsNumber` required | PcgsNumber |
| `FrNumber` | query | string | — | FrNumber |
| `NgcId` | query | integer ($int32) | — | NgcId |
| `Grade` | query | integer ($int32) | — | Grade |
| `MinGrade` | query | integer ($int32) | — | MinGrade |
| `MaxGrade` | query | integer ($int32) | — | MaxGrade |
| `ApiLevel` | query | string | — | `Advanced` for additional fields |
| `Accept` | header | string | yes | Accept Header. Available values: `application/json` |

### Responses

| Code | Description |
|---|---|
| 200 | Success — returns a [PricingResponse](#pricingresponse) |

**Response content type:** `application/json`

### Example response

```json
{
  "Data": [
    {
      "GsId": 0,
      "Name": "string",
      "SortingPosition": 0,
      "IsType": true,
      "IsSet": true,
      "UiParentId": 0,
      "PricingData": [
        {
          "Grade": 0,
          "GradeLabel": "string",
          "IsCac": true,
          "CpgVal": "string",
          "GreyVal": "string",
          "PcgsVal": "string",
          "NgcVal": "string",
          "BlueBookVal": "string"
        }
      ]
    }
  ],
  "Total": 0,
  "OpCode": 0,
  "ErrorText": "string",
  "RequestTime": "string",
  "ResponseTime": "string",
  "TotalExecutionTime": "string",
  "CachedResponse": true,
  "PermitAccess": true,
  "AccessDeniedMessage": "string"
}
```

---

# Models

## NodeResponse

Response envelope returned by `/GetNodeRequest` and `/GetNodeChildrenRequest`.

| Field | Type | Description |
|---|---|---|
| `Data` | array of [Node](#node) | The node(s) returned |
| `Total` | integer | Total number of items |
| `OpCode` | integer | Operation status code |
| `ErrorText` | string | Error message if applicable |
| `RequestTime` | string | When the request was received |
| `ResponseTime` | string | When the response was generated |
| `TotalExecutionTime` | string | Server-side execution time |
| `CachedResponse` | boolean | Whether the response was served from cache |
| `PermitAccess` | boolean | Whether the caller is permitted to access the data |
| `AccessDeniedMessage` | string | Reason for denial, if any |

## Node

| Field | Type | Description |
|---|---|---|
| `Id` | integer | Node identifier |
| `Name` | string | Node name |
| `Description` | string | Node description |
| `FeaturedImageUrl` | string | Image URL |
| `FeaturedImageAttribution` | string | Image attribution |
| `FlagCode` | string | Country flag code |
| `CountryName` | string | Country name |
| `SortingPosition` | integer | Display sort order |
| `NodeChildrenCountLive` | integer | Count of child nodes (>0 indicates this node has Node children) |
| `CollectibleChildrenCountLive` | integer | Count of child collectibles (>0 indicates this node has Collectible children) |
| `ParentNode_Id` | integer | Parent node ID |
| `RootNode_Id` | integer | Root node ID |
| `ChildNodes` | array of string | Child node references |

## CollectibleResponse

Response envelope returned by `/GetCollectibleRequest` and `/GetCollectibleByNodeRequest`.

| Field | Type | Description |
|---|---|---|
| `Data` | array of [Collectible](#collectible) | The collectible(s) returned |
| `Total` | integer | Total number of items |
| `OpCode` | integer | Operation status code |
| `ErrorText` | string | Error message if applicable |
| `RequestTime` | string | When the request was received |
| `ResponseTime` | string | When the response was generated |
| `TotalExecutionTime` | string | Server-side execution time |
| `CachedResponse` | boolean | Whether the response was served from cache |
| `PermitAccess` | boolean | Whether the caller is permitted to access the data |
| `AccessDeniedMessage` | string | Reason for denial, if any |

## Collectible

| Field | Type | Description |
|---|---|---|
| `Gsid` | integer | Greysheet identifier |
| `UiParentId` | integer | UI parent identifier |
| `Name` | string | Collectible name |
| `PcgsNumber` | string | PCGS number |
| `FriedbergNumber` | string | Friedberg number |
| `CoinDate` | string | Coin date |
| `DenominationShort` | string | Short denomination |
| `DenominationLong` | string | Long denomination |
| `Variety` | string | Variety |
| `Variety2` | string | Secondary variety |
| `Desg` | string | Designation |
| `Other` | string | Other notes |
| `Prefix` | string | Prefix |
| `MintMark` | string | Mint mark |
| `Composition` | string | Composition |
| `Mintage` | string | Mintage |
| `StrikeType` | string | Strike type |
| `Diameter` | string | Diameter |
| `Fineness` | string | Fineness |
| `WeightGrams` | number | Weight in grams |
| `WeightOunces` | number | Weight in ounces |
| `Designer` | string | Designer |
| `Edge` | string | Edge style |
| `Rarity` | string | Rarity |
| `CoinShape` | string | Shape |
| `Description` | string | Description |
| `GeneralNotes` | string | General notes |
| `GeneralNotesSource` | string | Source of general notes |
| `GeneralCoinLettering` | string | General coin lettering |
| `ObverseDescription` | string | Obverse description |
| `ObverseDesigner` | string | Obverse designer |
| `ObverseLettering` | string | Obverse lettering |
| `ReverseDescription` | string | Reverse description |
| `ReverseDesigner` | string | Reverse designer |
| `ReverseLettering` | string | Reverse lettering |
| `BnBNumber` | string | Bank Note Book number |
| `NoteColor` | string | Note color |
| `NoteDimension` | string | Note dimensions |
| `PickNumber` | string | Pick number |
| `Watermark` | string | Watermark |
| `Printer` | string | Printer |
| `NoteSecurityThread` | string | Security thread |
| `NotePaperType` | string | Paper type |
| `BnbSignatureName1` | string | Bank Note Book signature 1 |
| `BnbSignatureName2` | string | Bank Note Book signature 2 |
| `BnbSignatureName3` | string | Bank Note Book signature 3 |
| `ObsoleteBankId` | string | Obsolete bank ID |
| `ObsoleteStateName` | string | Obsolete bank state |
| `ObsoleteCityName` | string | Obsolete bank city |
| `ObsoleteBankName` | string | Obsolete bank name |
| `HaxbyNumber` | string | Haxby number |
| `BnbTitle` | string | Bank Note Book title |
| `IssueNumber` | string | Issue number |
| `IssueMonth` | integer | Issue month |
| `IssueYear` | integer | Issue year |
| `Variant` | string | Variant |
| `ArtComment1` | string | Art comment 1 |
| `ArtComment2` | string | Art comment 2 |
| `ArtComment3` | string | Art comment 3 |
| `KeyComment1` | string | Key comment 1 |
| `KeyComment2` | string | Key comment 2 |
| `KeyComment3` | string | Key comment 3 |
| `Ngc` | string | NGC reference |
| `NgcId` | integer | NGC numeric ID |
| `Krause` | string | Krause reference |
| `EbayCategory1` | integer | eBay category |
| `FeaturedImageUrl` | string | Image URL |
| `FeaturedImageAttribution` | string | Image attribution |
| `IsType` | boolean | Is a type entry |
| `IsSet` | boolean | Is a set entry |
| `PriceLow` | number | Low price |
| `PriceHigh` | number | High price |
| `Is100GreatestUSCoins` | integer | Listed in 100 Greatest US Coins |
| `Is100GreatestUSPaperMoney` | integer | Listed in 100 Greatest US Paper Money |
| `Is100GreatestWorldPaperMoney` | integer | Listed in 100 Greatest World Paper Money |
| `Is100GreatestModernUsCoins` | integer | Listed in 100 Greatest Modern US Coins |
| `IsRedbook` | boolean | Appears in the Redbook |
| `IsCherryPicker` | boolean | Appears in Cherrypicker's Guide |
| `RootNode_Id` | integer | Root node ID |
| `ParentNode_Id` | integer | Parent node ID |
| `ParentNodeName` | string | Parent node name |
| `SortingPosition` | integer | Display sort order |
| `CatalogPath` | array of [Node](#node) | Breadcrumb path of nodes from root to this collectible |

## PricingResponse

Response envelope returned by `/GetPricingRequest`.

| Field | Type | Description |
|---|---|---|
| `Data` | array of [PricingItem](#pricingitem) | The pricing items returned |
| `Total` | integer | Total number of items |
| `OpCode` | integer | Operation status code |
| `ErrorText` | string | Error message if applicable |
| `RequestTime` | string | When the request was received |
| `ResponseTime` | string | When the response was generated |
| `TotalExecutionTime` | string | Server-side execution time |
| `CachedResponse` | boolean | Whether the response was served from cache |
| `PermitAccess` | boolean | Whether the caller is permitted to access the data |
| `AccessDeniedMessage` | string | Reason for denial, if any |

## PricingItem

| Field | Type | Description |
|---|---|---|
| `GsId` | integer | Greysheet identifier |
| `Name` | string | Collectible name |
| `SortingPosition` | integer | Display sort order |
| `IsType` | boolean | Is a type entry |
| `IsSet` | boolean | Is a set entry |
| `UiParentId` | integer | UI parent identifier |
| `PricingData` | array of [PricingData](#pricingdata) | Price points by grade |

## PricingData

| Field | Type | Description |
|---|---|---|
| `Grade` | integer | Numeric grade |
| `GradeLabel` | string | Grade label |
| `IsCac` | boolean | Is CAC-stickered |
| `CpgVal` | string | CPG (Collector's Pricing Guide) value |
| `GreyVal` | string | Greysheet value |
| `PcgsVal` | string | PCGS value |
| `NgcVal` | string | NGC value |
| `BlueBookVal` | string | Bluebook value |

## Common Response Envelope Fields

Every endpoint wraps its payload in a standard envelope:

| Field | Type | Description |
|---|---|---|
| `Data` | array | Endpoint-specific payload |
| `Total` | integer | Total number of items in `Data` |
| `OpCode` | integer | Operation status code |
| `ErrorText` | string | Error message if applicable |
| `RequestTime` | string | When the request was received |
| `ResponseTime` | string | When the response was generated |
| `TotalExecutionTime` | string | Server-side execution time |
| `CachedResponse` | boolean | Whether the response was served from cache |
| `PermitAccess` | boolean | Whether the caller is permitted to access the data |
| `AccessDeniedMessage` | string | Reason for denial, if any |
