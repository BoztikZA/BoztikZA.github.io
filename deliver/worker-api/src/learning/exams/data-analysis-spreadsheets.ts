import type { ExamQuestion } from "../types.ts";

export const questions: ExamQuestion[] = [
  {
    "id": "data-01",
    "module": "m01",
    "kind": "single",
    "prompt": "In a table of café orders, which of these is a record rather than a field?",
    "options": [
      "The complete row describing order BZC-1017",
      "The column headed UnitPrice",
      "The column headed Region",
      "The rule that Quantity must be a number"
    ],
    "correct": [
      0
    ],
    "explain": "A record is one complete row: everything known about one order. Columns such as UnitPrice and Region are fields, and a rule about types is neither."
  },
  {
    "id": "data-02",
    "module": "m01",
    "kind": "scenario",
    "prompt": "A manager adds up a Revenue column and gets a total far higher than the till reports. She then notices that several order numbers appear on two identical rows. What is the best next step?",
    "options": [
      "Keep each order number once, then recalculate the total",
      "Convert every text value to capital letters, then recalculate",
      "Fill the odd rows with the column average, then recalculate",
      "Replace all prices with the till's figures, then recalculate"
    ],
    "correct": [
      0
    ],
    "explain": "Repeated identical orders are a duplication problem and they inflate totals. Keeping each OrderID once fixes it. Changing case, filling averages or replacing prices addresses problems that are not present."
  },
  {
    "id": "data-03",
    "module": "m01",
    "kind": "truefalse",
    "prompt": "True or false: a column of phone numbers is better treated as text than as numbers, because you will never add or average phone numbers.",
    "options": [
      "True",
      "False"
    ],
    "correct": [
      0
    ],
    "explain": "Identifiers such as phone numbers and order numbers are labels. Storing them as text also stops leading zeros being dropped."
  },
  {
    "id": "data-04",
    "module": "m02",
    "kind": "single",
    "prompt": "Which reference describes every UnitPrice value in rows 2 to 125 of the café file, where UnitPrice is column G?",
    "options": [
      "G2:H125",
      "G2:G125",
      "F2:G125",
      "A2:G125"
    ],
    "correct": [
      1
    ],
    "explain": "A range is written first cell, colon, last cell. UnitPrice is column G, so G2:G125 covers exactly those prices. The other ranges include other columns."
  },
  {
    "id": "data-05",
    "module": "m02",
    "kind": "single",
    "prompt": "A cell contains the result of 8542/110 and is formatted to show no decimal places. What is true?",
    "options": [
      "It shows 78 while still storing 77.6545...",
      "It shows 78 and now stores exactly 78",
      "It shows 77.65 because formats keep two decimals",
      "It shows an error because the result is not a whole number"
    ],
    "correct": [
      0
    ],
    "explain": "Formatting changes only what you see. The stored value keeps its decimals, and formulas that use the cell use the full value."
  },
  {
    "id": "data-06",
    "module": "m02",
    "kind": "scenario",
    "prompt": "An analyst imports 60 prices in G2:G61. `=COUNT(G2:G61)` returns 52, and `=SUM(G2:G61)` looks too low. What is the most likely explanation?",
    "options": [
      "Eight of the prices are stored as text",
      "Eight rows are hidden by a filter",
      "The sheet has a circular reference",
      "The workbook contains too many sheets"
    ],
    "correct": [
      0
    ],
    "explain": "COUNT and SUM only handle true numbers. When COUNT is lower than the number of filled cells, some values are stored as text and are being ignored."
  },
  {
    "id": "data-07",
    "module": "m03",
    "kind": "single",
    "prompt": "Which file type stores only the values, with no formulas, formatting or extra sheets?",
    "options": [
      "An .xlsx workbook",
      "An .ods spreadsheet",
      "A CSV file",
      "A shared Google Sheets file"
    ],
    "correct": [
      2
    ],
    "explain": "A CSV is plain text with values separated by commas. Workbooks in .xlsx or .ods can hold formulas, formatting and several sheets."
  },
  {
    "id": "data-08",
    "module": "m03",
    "kind": "multi",
    "prompt": "Select all that apply. A colleague opens your workbook and sees a name error for a function you used. Which are plausible causes?",
    "options": [
      "Their header row is frozen",
      "Their program version does not include that function",
      "Their dates are in year-month-day order",
      "The function is named or supported differently in their program"
    ],
    "correct": [
      1,
      3
    ],
    "explain": "Function availability and naming vary between programs and versions. A frozen header and a date order have no effect on whether a function is recognised."
  },
  {
    "id": "data-09",
    "module": "m03",
    "kind": "single",
    "prompt": "Which layout keeps a dataset safe for sorting, filtering and PivotTables?",
    "options": [
      "A title row, a blank row, then a header, with weekly totals between the records",
      "Merged cells across the top to show each month, then the records underneath",
      "Each month's sales placed in separate groups of columns beside each other",
      "One header row followed by an unbroken block of records, with no totals inside it"
    ],
    "correct": [
      3
    ],
    "explain": "Tools like sorting and PivotTables assume a clean block with one header and one record per row. Titles, blanks, merged cells and embedded totals break that assumption."
  },
  {
    "id": "data-10",
    "module": "m04",
    "kind": "scenario",
    "prompt": "A sales export has 200 data rows beneath the header. Six rows are entirely blank, and in the remaining rows 11 OrderIDs are repeats of an earlier identical row. How many orders remain after cleaning?",
    "options": [
      "194",
      "183",
      "189",
      "211"
    ],
    "correct": [
      1
    ],
    "explain": "Removing 6 blank rows leaves 194 rows. Removing 11 repeats leaves 183 distinct orders. The other figures skip a step or add instead of subtracting."
  },
  {
    "id": "data-11",
    "module": "m04",
    "kind": "single",
    "prompt": "Cell C2 contains \" johannesburg \" with a space at each end. Which formula returns the clean text Johannesburg?",
    "options": [
      "=TRIM(C2)",
      "=UPPER(C2)",
      "=PROPER(C2)",
      "=PROPER(TRIM(C2))"
    ],
    "correct": [
      3
    ],
    "explain": "TRIM removes the surrounding spaces and PROPER fixes the capitals. TRIM alone leaves lower case, UPPER gives capitals only, and PROPER alone keeps the spaces."
  },
  {
    "id": "data-12",
    "module": "m04",
    "kind": "multi",
    "prompt": "Select all that apply. Which practices should you follow before cleaning a dataset someone gave you?",
    "options": [
      "Overwrite the original file so only one version exists",
      "Keep an untouched copy of the raw data on its own sheet",
      "Record row counts before and after each cleaning step",
      "Delete any row that looks odd without checking it"
    ],
    "correct": [
      1,
      2
    ],
    "explain": "An untouched raw copy and a count log let you prove and reverse your steps. Overwriting the original or deleting unchecked rows destroys evidence and may remove real data."
  },
  {
    "id": "data-13",
    "module": "m05",
    "kind": "scenario",
    "prompt": "Cell L1 holds a service fee of 0.1, I2 holds 76 and I3 holds 38. In J2 you type `=I2*L1` and fill the formula down to J3. L2 is empty. What does J3 show?",
    "options": [
      "3.8",
      "0",
      "7.6",
      "#REF!"
    ],
    "correct": [
      1
    ],
    "explain": "The relative reference L1 slides to L2 in the next row, so J3 becomes =I3*L2. An empty cell counts as 0, so the result is 0. Locking the fee with $L$1 would have given 3.8."
  },
  {
    "id": "data-14",
    "module": "m05",
    "kind": "single",
    "prompt": "Categories are in E2:E111 and Revenue is in I2:I111. Which formula returns total revenue for Tea orders?",
    "options": [
      "=SUMIF(I2:I111,\"Tea\",E2:E111)",
      "=COUNTIF(E2:E111,\"Tea\")",
      "=SUMIF(E2:E111,\"Tea\",I2:I111)",
      "=SUM(E2:E111,\"Tea\")"
    ],
    "correct": [
      2
    ],
    "explain": "SUMIF takes the range to test, the criterion, then the range to add. Swapping the ranges tests revenue for the word Tea, and COUNTIF counts orders instead of adding revenue. On the clean café data this returns R1,360."
  },
  {
    "id": "data-15",
    "module": "m05",
    "kind": "scenario",
    "prompt": "On the clean café data, a manager wants the number of Light meals orders placed in March 2026. Category is in E2:E111 and real dates are in B2:B111. Which formula answers her question?",
    "options": [
      "=COUNTIF(E2:E111,\"Light meals\")",
      "=SUMIFS(I2:I111,E2:E111,\"Light meals\",B2:B111,\">=\"&DATE(2026,3,1))",
      "=COUNTIFS(E2:E111,\"Light meals\",B2:B111,\"March\")",
      "=COUNTIFS(E2:E111,\"Light meals\",B2:B111,\">=\"&DATE(2026,3,1),B2:B111,\"<\"&DATE(2026,4,1))"
    ],
    "correct": [
      3
    ],
    "explain": "COUNTIFS applies several conditions: the category and a date range covering March. The first option ignores the month, the second adds revenue instead of counting orders, and the third compares real dates with the word March, which never matches. The correct formula returns 8 on the clean data."
  },
  {
    "id": "data-16",
    "module": "m06",
    "kind": "single",
    "prompt": "A PivotTable is built from the cleaned café data with Region in Rows and Count of OrderID in Values. What does the Johannesburg row show?",
    "options": [
      "32",
      "2,712",
      "35",
      "77.49"
    ],
    "correct": [
      2
    ],
    "explain": "Count of OrderID gives the number of orders: 35 for Johannesburg. R2,712 is its revenue, and 32 is what an untrimmed COUNTIF returns when stray spaces remain."
  },
  {
    "id": "data-17",
    "module": "m06",
    "kind": "scenario",
    "prompt": "A manager filters the clean café data to show only Durban. The plain `=SUM(I2:I111)` under the data still shows 8542. Which formula gives the total of the visible rows, and what does it return?",
    "options": [
      "=SUM(I2:I111), which returns 2555 once the filter is applied",
      "=SUBTOTAL(9,I2:I111), which still returns 8542 because it counts hidden rows",
      "=COUNT(I2:I111), which returns 2555",
      "=SUBTOTAL(9,I2:I111), which returns 2555"
    ],
    "correct": [
      3
    ],
    "explain": "SUM includes hidden rows, whereas SUBTOTAL with the summing option ignores rows hidden by a filter. Durban's revenue is R2,555. COUNT would give a number of orders, not a total."
  },
  {
    "id": "data-18",
    "module": "m06",
    "kind": "single",
    "prompt": "Which PivotTable layout best answers \"how many orders of each category were placed in each month?\"",
    "options": [
      "Rows: SalesRep; Values: Average of UnitPrice",
      "Rows: Month; Columns: Category; Values: Count of OrderID",
      "Rows: OrderID; Values: Sum of Revenue",
      "Rows: Region; Values: Sum of Quantity"
    ],
    "correct": [
      1
    ],
    "explain": "Months down the side and categories across the top, counting OrderID, produce a grid whose cells are order counts. The other layouts summarise different fields."
  },
  {
    "id": "data-19",
    "module": "m07",
    "kind": "single",
    "prompt": "Which is the weakest choice for showing units sold for each of the café's thirteen products?",
    "options": [
      "A sorted horizontal bar chart",
      "A sorted column chart",
      "A pie chart with thirteen slices",
      "A bar chart with each bar labelled with its value"
    ],
    "correct": [
      2
    ],
    "explain": "Thirteen thin pie slices cannot be compared easily and need a long legend. Sorted bars let the reader rank products at a glance."
  },
  {
    "id": "data-20",
    "module": "m07",
    "kind": "scenario",
    "prompt": "A manager's column chart of revenue by region starts its value axis at R2,500, so Johannesburg (R2,712) looks nearly three times as tall as Cape Town (R2,579). What is the best fix?",
    "options": [
      "Make the chart 3D so the difference looks more natural",
      "Replace the columns with a pie of four slices",
      "Make the title bolder so readers notice the gap",
      "Start the value axis at zero so column heights match the values"
    ],
    "correct": [
      3
    ],
    "explain": "Truncating a bar axis exaggerates a gap of about 5%. Starting at zero makes column length proportional to value. 3D, a pie or a bolder title do not correct the distortion."
  },
  {
    "id": "data-21",
    "module": "m07",
    "kind": "truefalse",
    "prompt": "True or false: if a scatter chart shows two measures rising together, that proves one of them causes the other.",
    "options": [
      "True",
      "False"
    ],
    "correct": [
      1
    ],
    "explain": "A scatter chart shows association. Two measures can rise together because of a third factor, or by coincidence, so further evidence is needed for a claim about cause."
  },
  {
    "id": "data-22",
    "module": "m08",
    "kind": "single",
    "prompt": "Your finding is that one branch earns far less than the others. Which opening sentence best suits a busy reader?",
    "options": [
      "This report describes how the raw data was received and cleaned.",
      "The café has four branches, and sales were recorded from January to March.",
      "Gqeberha earned R696 from 12 orders, far below each of the other three branches, which each earned over R2,500.",
      "Many interesting patterns appear in the data, as the charts below show."
    ],
    "correct": [
      2
    ],
    "explain": "A good opening states the answer with the key numbers. The other options describe background, method or promise patterns without saying what was found."
  },
  {
    "id": "data-23",
    "module": "m08",
    "kind": "single",
    "prompt": "An analyst's four region totals add up to R8,542, but her four category totals add up to R8,610. What is the most sensible conclusion?",
    "options": [
      "Different breakdowns often total different amounts, so nothing is wrong",
      "The difference is rounding and can be ignored",
      "One of the summaries or its source range contains an error that must be found",
      "The larger total should be reported because it is more cautious"
    ],
    "correct": [
      2
    ],
    "explain": "Two complete breakdowns of the same data must reach the same total. A mismatch means a range, a filter or a cleaning step differs, and it should be traced before reporting."
  },
  {
    "id": "data-24",
    "module": "m08",
    "kind": "multi",
    "prompt": "Select all that apply. Monthly revenue in the cleaned café data was R2,344, R2,904 and R3,294 for January to March, and Cappuccino sold the most units (55). Which statements are fully supported by the data?",
    "options": [
      "Revenue was higher in each month than in the month before",
      "A promotion in February caused the rise in revenue",
      "April revenue will exceed R3,294",
      "Cappuccino sold more units than any other product"
    ],
    "correct": [
      0,
      3
    ],
    "explain": "The first and last statements describe what the data shows. A cause for the rise and a forecast for April are interpretations that the file cannot confirm."
  },
  {
    "id": "data-25",
    "module": "m09",
    "kind": "single",
    "prompt": "A dashboard KPI uses `=COUNTA(Clean!A2:A111)` to count orders. A colleague then pastes 20 new orders into rows 112 to 131. What does the KPI show?",
    "options": [
      "130, because COUNTA follows the whole sheet",
      "110, because the formula's range stops at row 111",
      "#REF!, because the range has changed",
      "20, because it counts only the newest rows"
    ],
    "correct": [
      1
    ],
    "explain": "A fixed range only covers the rows it names. New rows outside it are ignored, which is why dashboards should use a table or a range that grows with the data."
  },
  {
    "id": "data-26",
    "module": "m09",
    "kind": "single",
    "prompt": "A dashboard built on the clean café data has its region selector set to Durban. Which KPI figures should it show for revenue and number of orders?",
    "options": [
      "R2,555 and 110",
      "R2,579 and 33",
      "R8,542 and 30",
      "R2,555 and 30"
    ],
    "correct": [
      3
    ],
    "explain": "Durban's revenue is R2,555 from 30 orders. R2,579 and 33 belong to Cape Town, and mixing Durban's figures with the all-region totals means the selector is not applied to every KPI."
  },
  {
    "id": "data-27",
    "module": "m09",
    "kind": "truefalse",
    "prompt": "True or false: a dashboard built on data that still contains repeated orders will show inflated figures even if every formula is written correctly.",
    "options": [
      "True",
      "False"
    ],
    "correct": [
      0
    ],
    "explain": "Formulas faithfully process whatever data they are given. Repeated records add their revenue twice, so the KPIs are too high even though the formulas are correct."
  },
  {
    "id": "data-28",
    "module": "m10",
    "kind": "single",
    "prompt": "Which order of steps is correct when preparing a downloaded sales file for analysis?",
    "options": [
      "Add Revenue, remove duplicates, fix Region spellings, then remove blank rows",
      "Remove duplicates, add Revenue, back up the file, then fix Region spellings",
      "Fix Region spellings, add Revenue, back up the file, then remove blank rows",
      "Back up the raw data, remove blank rows, keep each OrderID once, fix Region spellings, then add Revenue"
    ],
    "correct": [
      3
    ],
    "explain": "Protect the raw data first, then remove blank rows, then repeated orders, then standardise text, and only then calculate. Each step prevents the next from being confused by earlier problems."
  },
  {
    "id": "data-29",
    "module": "m10",
    "kind": "single",
    "prompt": "On the cleaned practice file, Bakery revenue is R1,338 and total revenue is R8,542. Which gives Bakery's share of total revenue?",
    "options": [
      "1,338 / 110, about R12.16",
      "1,338 / 9,152, about 14.6%",
      "1,338 / 8,542, about 15.7%",
      "23 / 110, about 20.9%"
    ],
    "correct": [
      2
    ],
    "explain": "A revenue share divides the category's revenue by total revenue from the cleaned data. Using the inflated total of R9,152 or an order count answers a different question."
  },
  {
    "id": "data-30",
    "module": "m10",
    "kind": "single",
    "prompt": "Which method correctly finds the number of Coffee orders placed in February?",
    "options": [
      "Sum Quantity for Coffee across the whole file",
      "Count the cleaned rows where Category is Coffee and the date falls in February",
      "Count the cleaned rows whose date falls in February, whatever the category",
      "Sum Revenue for Coffee rows dated in February"
    ],
    "correct": [
      1
    ],
    "explain": "Orders are counted as rows, and both conditions apply: the category and the month. On the practice file the answer is 12. The other methods count units or revenue, or ignore a condition."
  }
];
