const disclaimer =
  "FirePath provides educational information and financial calculations only. It does not provide investment, tax, legal, or financial advice. Always do your own research or consult a qualified professional.";

const currency = new Intl.NumberFormat("en-DE", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0
});

const percent = new Intl.NumberFormat("en-DE", {
  style: "percent",
  maximumFractionDigits: 0
});

const inputs = [
  "monthlyIncome",
  "monthlyExpenses",
  "monthlyInvestment",
  "cash",
  "investments",
  "debts",
  "fireSpending",
  "withdrawalRate",
  "expectedReturn",
  "inflation"
];

const stateKey = "firepath-web-state-v1";
const holdingsKey = "firepath-web-holdings-v1";

function makeId() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

const defaultHoldings = [
  { id: makeId(), name: "Global ETF", value: 32000, invested: 28000 },
  { id: makeId(), name: "Cash reserve", value: 21000, invested: 21000 },
  { id: makeId(), name: "Bond fund", value: 4000, invested: 4200 }
];

function readNumber(id) {
  const value = Number(document.getElementById(id).value);
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

function readRate(id) {
  const value = Number(document.getElementById(id).value);
  return Number.isFinite(value) ? value / 100 : 0;
}

function saveInputs() {
  const payload = Object.fromEntries(inputs.map((id) => [id, document.getElementById(id).value]));
  localStorage.setItem(stateKey, JSON.stringify(payload));
}

function restoreInputs() {
  const saved = JSON.parse(localStorage.getItem(stateKey) || "{}");
  for (const id of inputs) {
    if (saved[id] !== undefined) {
      document.getElementById(id).value = saved[id];
    }
  }
}

function calculateYearsToFire(currentAmount, monthlyContribution, targetAmount, annualReturn) {
  if (targetAmount <= currentAmount) return 0;
  if (monthlyContribution <= 0) return null;

  const monthlyReturn = annualReturn / 12;
  const gap = targetAmount - currentAmount;

  if (Math.abs(monthlyReturn) < 0.000001) {
    return gap / monthlyContribution / 12;
  }

  const months = Math.log((targetAmount * monthlyReturn + monthlyContribution) / (currentAmount * monthlyReturn + monthlyContribution)) / Math.log(1 + monthlyReturn);
  return Number.isFinite(months) && months >= 0 ? months / 12 : null;
}

function formatYears(years) {
  if (years === null) return "Not reachable";
  if (years === 0) return "Ready";
  return years.toFixed(1);
}

function updateDashboard() {
  const monthlyIncome = readNumber("monthlyIncome");
  const monthlyExpenses = readNumber("monthlyExpenses");
  const monthlyInvestment = readNumber("monthlyInvestment");
  const cash = readNumber("cash");
  const investments = readNumber("investments");
  const debts = readNumber("debts");
  const fireSpending = readNumber("fireSpending") || monthlyExpenses;
  const withdrawalRate = Math.max(readRate("withdrawalRate"), 0.001);
  const expectedReturn = readRate("expectedReturn");
  const inflation = readRate("inflation");

  const netWorth = Math.max(0, cash + investments - debts);
  const monthlySavings = Math.max(0, monthlyIncome - monthlyExpenses);
  const savingsRate = monthlyIncome > 0 ? monthlySavings / monthlyIncome : 0;
  const fireNumber = (fireSpending * 12) / withdrawalRate;
  const realReturn = ((1 + expectedReturn) / (1 + inflation)) - 1;
  const years = calculateYearsToFire(netWorth, monthlyInvestment, fireNumber, realReturn);
  const progress = fireNumber > 0 ? Math.min(netWorth / fireNumber, 1) : 0;
  const emergencyMonths = monthlyExpenses > 0 ? cash / monthlyExpenses : 0;

  document.getElementById("netWorthValue").textContent = currency.format(netWorth);
  document.getElementById("fireNumberValue").textContent = currency.format(fireNumber);
  document.getElementById("savingsRateValue").textContent = percent.format(Math.max(0, Math.min(savingsRate, 1)));
  document.getElementById("yearsValue").textContent = formatYears(years);
  document.getElementById("emergencyValue").textContent = `${emergencyMonths.toFixed(1)} mo`;
  document.getElementById("progressLabel").textContent = percent.format(progress);
  document.getElementById("progressBar").style.width = `${Math.max(2, progress * 100)}%`;

  saveInputs();
}

function loadHoldings() {
  try {
    return JSON.parse(localStorage.getItem(holdingsKey)) || defaultHoldings;
  } catch {
    return defaultHoldings;
  }
}

function saveHoldings(holdings) {
  localStorage.setItem(holdingsKey, JSON.stringify(holdings));
}

function renderHoldings() {
  const holdings = loadHoldings();
  const list = document.getElementById("holdingsList");
  const portfolioValue = holdings.reduce((sum, holding) => sum + Number(holding.value || 0), 0);
  const invested = holdings.reduce((sum, holding) => sum + Number(holding.invested || 0), 0);
  const gainLoss = portfolioValue - invested;

  document.getElementById("portfolioValue").textContent = currency.format(portfolioValue);
  document.getElementById("gainLoss").textContent = currency.format(gainLoss);
  document.getElementById("investments").value = String(Math.max(0, Math.round(portfolioValue)));

  list.innerHTML = "";

  if (holdings.length === 0) {
    list.innerHTML = "<p class='muted'>No holdings yet.</p>";
    updateDashboard();
    return;
  }

  for (const holding of holdings) {
    const row = document.createElement("article");
    row.className = "holding-row";
    row.innerHTML = `
      <div>
        <span>${escapeHtml(holding.name)}</span>
        <strong>${currency.format(Number(holding.value || 0))}</strong>
      </div>
      <strong>${currency.format(Number(holding.value || 0) - Number(holding.invested || 0))}</strong>
      <button type="button" aria-label="Remove ${escapeHtml(holding.name)}">×</button>
    `;
    row.querySelector("button").addEventListener("click", () => {
      saveHoldings(loadHoldings().filter((item) => item.id !== holding.id));
      renderHoldings();
    });
    list.appendChild(row);
  }

  updateDashboard();
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => {
    const map = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" };
    return map[char];
  });
}

document.getElementById("fireForm").addEventListener("input", updateDashboard);

document.getElementById("holdingForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const name = document.getElementById("holdingName").value.trim() || "Holding";
  const value = readNumber("holdingValue");
  const invested = readNumber("holdingInvested");
  const holdings = loadHoldings();
  holdings.push({ id: makeId(), name, value, invested });
  saveHoldings(holdings);
  renderHoldings();
});

restoreInputs();
renderHoldings();
console.info(disclaimer);
