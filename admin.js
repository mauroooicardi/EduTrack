// --- Tab Switching Logic ---
function switchTab(tabName) {
  // Hide all contents
  const contents = document.querySelectorAll('.tab-content');
  contents.forEach(c => c.classList.remove('active'));

  // Deactivate all nav buttons
  const navItems = document.querySelectorAll('.nav-item');
  navItems.forEach(n => n.classList.remove('active'));

  // Activate selected tab
  document.getElementById(`tab-${tabName}`).classList.add('active');

  // Activate button
  event.currentTarget.classList.add('active');

  // Dynamic Titles
  const titleMap = {
    'overview': 'İcmal Panel',
    'students': 'Şagirdlər və Valideynlər',
    'exams': 'Sınaq Nəticələri',
    'attendance': 'Davamiyyət İdarəetməsi',
    'homework': 'Ev Tapşırıqları'
  };
  document.getElementById('page-title').innerText = titleMap[tabName];
}

// --- Modal Control ---
function openModal(id) {
  document.getElementById(id).classList.add('active');
}

function closeModal(id) {
  document.getElementById(id).classList.remove('active');
}