// Sample data for the redesign prototype. Values are illustrative.
const T = [
  { id: 1, day: "Thu 22 Oct", title: "Ramen Kazu — dinner with Lena and Tom", cat: "Restaurants", icon: "tools-kitchen-2", tags: ["Personal", "Shared"], flags: ["receipt", "pin", "reimb"], amt: 96.0, net: 64.0 },
  { id: 2, day: "Thu 22 Oct", title: "Lena — her share of ramen", cat: "Income", name: "Reimbursement", icon: "arrow-back-up", tags: ["Shared"], flags: ["reimb"], amt: 32.0, income: true },
  { id: 3, day: "Thu 22 Oct", title: "Edeka Schwabing", cat: "Groceries", icon: "shopping-cart", tags: ["Essential", "Household"], flags: ["receipt", "pin"], amt: 47.38 },
  { id: 4, day: "Thu 22 Oct", title: "Bäckerei Ziegler", cat: "Groceries", icon: "shopping-cart", tags: ["Essential"], flags: ["pin"], amt: 4.8 },
  { id: 5, day: "Wed 21 Oct", title: "DB ICE 1003 München Hbf → Berlin Hbf, conference trip", cat: "Travel", icon: "train", tags: ["Work", "Reimbursable", "Q4 offsite"], flags: ["receipt"], amt: 89.9 },
  { id: 6, day: "Wed 21 Oct", title: "IKEA Brunnthal — Kallax shelf and 4 boxes", cat: "Home", icon: "armchair", tags: ["Home", "Durable"], flags: ["receipt", "pin"], amt: 214.96 },
  { id: 7, day: "Wed 21 Oct", title: "Rossmann", cat: "Shopping", name: "Drugstore", icon: "first-aid-kit", tags: [], flags: [], amt: 18.45 },
  { id: 8, day: "Tue 20 Oct", title: "Spotify Family", cat: "Other", name: "Subscriptions", icon: "music", tags: ["Recurring"], flags: [], amt: 17.99 },
  { id: 9, day: "Tue 20 Oct", title: "Stadtwerke München — electricity October", cat: "Utilities", icon: "bolt", tags: ["Essential", "Household", "Recurring"], flags: ["receipt"], amt: 78.0 },
  { id: 10, day: "Tue 20 Oct", title: "MVV monthly pass", cat: "Transport", icon: "bus", tags: ["Commute"], flags: [], amt: 63.0 },
  { id: 11, day: "Thu 1 Oct", title: "Salary October", cat: "Income", name: "Salary", icon: "briefcase", tags: [], flags: [], amt: 4300.0, income: true },
  { id: 12, day: "Thu 1 Oct", title: "Rent October", cat: "Housing", icon: "home", tags: ["Essential", "Recurring"], flags: ["receipt"], amt: 1250.0 },
  { id: 13, day: "Thu 1 Oct", title: "Hardware store", cat: "Shopping", icon: "tool", tags: ["Personal"], flags: ["pin"], amt: 42.5 },
];

// Category name -> [color key, icon]
const CAT = {
  Housing: ["Housing", "home"], Groceries: ["Groceries", "shopping-cart"], Restaurants: ["Restaurants", "tools-kitchen-2"],
  Shopping: ["Shopping", "shopping-bag"], Drugstore: ["Shopping", "first-aid-kit"], Travel: ["Travel", "train"],
  Utilities: ["Utilities", "bolt"], Transport: ["Transport", "bus"], Home: ["Home", "armchair"], Subscriptions: ["Other", "music"],
  Insurance: ["Housing", "shield"], Health: ["Shopping", "heartbeat"], Other: ["Other", "dots"],
  Salary: ["Income", "briefcase"], Reimbursement: ["Income", "arrow-back-up"], Interest: ["Income", "percentage"],
};

const MONTHS6 = ["May", "Jun", "Jul", "Aug", "Sep", "Oct"];
const SPEND = {
  Housing: [1250, 1250, 1250, 1250, 1250, 1250], Groceries: [441, 402, 430, 398, 455, 412], Restaurants: [226, 212, 280, 249, 301, 238],
  Shopping: [220, 145, 160, 310, 190, 257], Travel: [0, 40, 610, 92, 420, 130], Utilities: [78, 78, 78, 78, 78, 78],
  Transport: [63, 63, 63, 63, 63, 63], Other: [179, 189, 96, 128, 110, 140],
};
const INCOME_OCT = { Salary: 4300, Reimbursement: 32, Interest: 14.2 };

// Month-end balances (actual) and the 6-month forecast with its 80% range (p10 to p90).
const BAL = {
  labels: ["May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar", "Apr"],
  actual: [24100, 24650, 25200, 24900, 26276, 28008, null, null, null, null, null, null],
  likely: [null, null, null, null, null, 28008, 28620, 28910, 29880, 30540, 31120, 31690],
  p10: [null, null, null, null, null, 28008, 27980, 27720, 28160, 28330, 28420, 28510],
  p90: [null, null, null, null, null, 28008, 29240, 30080, 31560, 32700, 33790, 34850],
};

const BUDGETS = [
  { cat: "Groceries", spent: 397.3, limit: 600 },
  { cat: "Restaurants", spent: 249, limit: 250, usual: 200 },
  { cat: "Shopping", spent: 257, limit: 300 },
  { cat: "Travel", spent: 130, limit: 250 },
  { cat: "Utilities", spent: 78, limit: 90 },
  { cat: "Subscriptions", spent: 140, limit: 120 },
];
const PACE = 22 / 31;

const TAGS = ["Essential", "Household", "Personal", "Shared", "Work", "Reimbursable", "Recurring", "Commute", "Home", "Durable", "Q4 offsite", "Japan 2026"];
