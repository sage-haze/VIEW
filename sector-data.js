const SECTOR_DATA = {
  "Agriculture, forestry and fishing": [
    "Crop and animal production, hunting and related service activities",
    "Forestry and logging",
    "Fishing and aquaculture"
  ],
  "Mining and quarrying": [
    "Mining of coal and lignite",
    "Extraction of crude petroleum and natural gas",
    "Mining of metal ores",
    "Other mining and quarrying",
    "Mining support service activities"
  ],
  "Manufacturing": [
    "Manufacture of food products",
    "Manufacture of beverages",
    "Manufacture of tobacco products",
    "Manufacture of textiles",
    "Manufacture of wearing apparel",
    "Manufacture of leather and related products",
    "Manufacture of wood and of products of wood and cork, except furniture; manufacture of articles of straw and plaiting materials",
    "Manufacture of paper and paper products",
    "Printing and reproduction of recorded media",
    "Manufacture of coke and refined petroleum products",
    "Manufacture of chemicals and chemical products",
    "Manufacture of basic pharmaceutical products and pharmaceutical preparations",
    "Manufacture of rubber and plastics products",
    "Manufacture of other non-metallic mineral products",
    "Manufacture of basic metals",
    "Manufacture of fabricated metal products, except machinery and equipment",
    "Manufacture of computer, electronic and optical products",
    "Manufacture of electrical equipment",
    "Manufacture of machinery and equipment, not elsewhere classified",
    "Manufacture of motor vehicles, trailers and semi-trailers",
    "Manufacture of other transport equipment",
    "Manufacture of furniture",
    "Other manufacturing",
    "Repair and installation of machinery and equipment"
  ],
  "Electricity, gas, steam and air conditioning supply": [
    "Electricity, gas, steam and air conditioning supply"
  ],
  "Water supply; sewerage, waste management and remediation activities": [
    "Water collection, treatment and supply",
    "Sewerage",
    "Waste collection, treatment and disposal activities; materials recovery",
    "Remediation activities and other waste management services"
  ],
  "Construction": [
    "Construction of buildings",
    "Construction of private residential housing",
    "Construction of private condominium",
    "Construction of private apartment and service apartment",
    "Construction of government residential housing and condominium",
    "Construction of private commercial building",
    "Construction of private office building",
    "Construction of private shopping center and department store",
    "Construction of private hotel and resort",
    "Construction of private factory",
    "Civil engineering",
    "Specialized construction activities"
  ],
  "Wholesale and retail trade; repair of motor vehicles and motorcycles": [
    "Wholesale and retail trade and repair of motor vehicles and motorcycles",
    "Wholesale trade, except of motor vehicles and motorcycles",
    "Retail trade, except of motor vehicles and motorcycles"
  ],
  "Transportation and storage": [
    "Land transport and transport via pipelines",
    "Water transport",
    "Air transport",
    "Warehousing and support activities for transportation",
    "Postal and courier activities"
  ],
  "Accommodation and food service activities": [
    "Accommodation",
    "Food and beverage service activities"
  ],
  "Information and communication": [
    "Publishing activities",
    "Motion picture, video and television programme production, sound recording and music publishing activities",
    "Programming and broadcasting activities",
    "Telecommunications",
    "Computer programming, consultancy and related activities",
    "Information service activities"
  ],
  "Financial and insurance activities": [
    "Financial service activities, except insurance and pension funding",
    "Thai commercial bank",
    "Restricted bank",
    "Branches of foreign bank",
    "International banking facilities of foreign bank",
    "Representative office of foreign bank",
    "Foreign bank",
    "Retail bank",
    "Subsidiary of foreign bank",
    "Other commercial bank",
    "Agricultural cooperative including the agricultural co-operative federation",
    "Thrift and credit cooperatives including the federation of savings and credit cooperatives",
    "Factoring activities",
    "Writing of swaps, options and other hedging instruments",
    "Others distribution of funds activities",
    "Insurance, reinsurance and pension funding, except compulsory social security",
    "Reinsurance (life)",
    "Reinsurance (non-life)",
    "Activities auxiliary to financial service and insurance activities",
    "Securities company",
    "Securities brokers and traders",
    "Underwriters",
    "Others securities brokerage activities",
    "Authorized company",
    "Authorized person",
    "International money transfer",
    "Other activities of bureaux de change",
    "Asset management",
    "Other of other activities auxiliary to financial service activities, not elsewhere classified",
    "Mutual fund management",
    "Others investment fund management, including hedge fund"
  ],
  "Real estate activities": [
    "Real estate activities",
    "Real estate development for residential housing",
    "Real estate development for condominium and flat for sale",
    "Land development for residential housing",
    "Real estate development for commercial building",
    "Land development for agriculture",
    "Land development for industry",
    "Real estate development for apartment and service apartment for rent",
    "Office building business for sale and rent",
    "Shopping center business and department store for sale and rent",
    "Land development for cemetery",
    "Golf course business",
    "Other of other real estate activities with own or leased property"
  ],
  "Professional, scientific and technical activities": [
    "Legal and accounting activities",
    "Activities of head offices; management consultancy activities",
    "Architectural and engineering activities; technical testing and analysis",
    "Scientific research and development",
    "Advertising and market research",
    "Other professional, scientific and technical activities",
    "Veterinary activities"
  ],
  "Administrative and support service activities": [
    "Rental and leasing activities",
    "Employment activities",
    "Travel agency, tour operator, reservation service and related activities",
    "Security and investigation activities",
    "Services to buildings and landscape activities",
    "Office administrative, office support and other business support activities"
  ],
  "Public administration and defence; compulsory social security": [
    "Public administration and defence; compulsory social security"
  ],
  "Education": [
    "Education"
  ],
  "Human health and social work activities": [
    "Human health activities",
    "Residential care activities",
    "Social work activities without accommodation"
  ],
  "Arts, entertainment and recreation": [
    "Creative, arts and entertainment activities",
    "Libraries, archives, museums and other cultural activities",
    "Gambling and betting activities",
    "Sports activities and amusement and recreation activities"
  ],
  "Other service activities": [
    "Activities of membership organizations",
    "Repair of computers and personal and household goods",
    "Other personal service activities"
  ],
  "Activities of households as employers; undifferentiated goods- and services-producing activities of households for own use": [
    "Activities of households as employers of domestic personnel",
    "Undifferentiated goods- and services-producing activities of private households for own use"
  ],
  "Activities of extraterritorial organizations and bodies": [
    "Activities of extraterritorial organizations and bodies"
  ]
};

const SUBSECTOR_KEYWORD_MAP = {
  "Thai commercial bank": [
    "Thailand banking",
    "Bank of Thailand",
    "digital banking",
    "loan growth",
    "credit risk",
    "NPL",
    "capital adequacy",
    "compliance"
  ],

  "Branches of foreign bank": [
    "foreign bank Thailand",
    "cross-border banking",
    "bank regulation",
    "capital requirements"
  ],

  "Insurance, reinsurance and pension funding, except compulsory social security": [
    "insurance Thailand",
    "reinsurance",
    "insurance regulation",
    "premiums",
    "claims",
    "solvency"
  ],

  "Manufacture of computer, electronic and optical products": [
    "electronics manufacturing",
    "semiconductors",
    "chip supply chain",
    "exports",
    "Thailand electronics"
  ],

  "Real estate development for residential housing": [
    "housing market",
    "property development",
    "mortgage demand",
    "Thailand property"
  ],

  "Construction of buildings": [
    "construction sector",
    "infrastructure",
    "building costs",
    "property development"
  ],

  "Computer programming, consultancy and related activities": [
    "software services",
    "IT consulting",
    "digital transformation",
    "cloud services",
    "AI adoption"
  ],

  "Telecommunications": [
    "telecom",
    "5G",
    "mobile network",
    "broadband",
    "infrastructure"
  ],

  "Electricity, gas, steam and air conditioning supply": [
    "power generation",
    "energy prices",
    "utilities",
    "renewable energy"
  ],

  "Food and beverage service activities": [
    "restaurants",
    "food service",
    "consumer spending",
    "tourism",
    "food inflation"
  ]
};
