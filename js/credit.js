
// Function to handle showing the credit page
function showCreditPage() {
    showPage('credit');
}

// Event listener for the credit tab
document.querySelector('[data-page="credit"]').addEventListener('click', showCreditPage);

// Load credit data from local storage
let creditData = JSON.parse(localStorage.getItem('creditData')) || [];

// Function to render credit data in the table
function renderCreditData() {
    const creditTbody = document.getElementById('credit-tbody');
    creditTbody.innerHTML = '';

    creditData.forEach((employee, index) => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td style="text-align:left; padding:8px;">${employee.name}</td>
            <td style="text-align:right; padding:8px;">${employee.limit}</td>
            <td style="text-align:right; padding:8px;">${employee.used}</td>
            <td style="text-align:center; padding:8px;">
                <button class="btn btn-s" onclick="editEmployee(${index})">Edit</button>
                <button class="btn btn-d" onclick="deleteEmployee(${index})">Delete</button>
            </td>
        `;
        creditTbody.appendChild(row);
    });
}

// Function to add a new employee
function addEmployee() {
    const employeeNameInput = document.getElementById('c-employee-name');
    const creditLimitInput = document.getElementById('c-credit-limit');

    const name = employeeNameInput.value.trim();
    const limit = parseFloat(creditLimitInput.value);

    if (name && !isNaN(limit)) {
        creditData.push({ name, limit, used: 0 });
        saveCreditData();
        renderCreditData();
        employeeNameInput.value = '';
        creditLimitInput.value = '';
    } else {
        alert('Please enter a valid name and credit limit.');
    }
}

// Function to delete an employee
function deleteEmployee(index) {
    if (confirm('Are you sure you want to delete this employee?')) {
        creditData.splice(index, 1);
        saveCreditData();
        renderCreditData();
    }
}

// Function to edit an employee's credit limit
function editEmployee(index) {
    const newLimit = prompt('Enter the new credit limit:', creditData[index].limit);
    if (newLimit !== null) {
        const limit = parseFloat(newLimit);
        if (!isNaN(limit)) {
            creditData[index].limit = limit;
            saveCreditData();
            renderCreditData();
        } else {
            alert('Please enter a valid number for the credit limit.');
        }
    }
}

// Function to save credit data to local storage
function saveCreditData() {
    localStorage.setItem('creditData', JSON.stringify(creditData));
}

// Initial render of credit data
renderCreditData();
