/**
 * å­¦çé¢çº¦å®éªç®¡çç³»ç» - å¬å±JavaScript
 */

// ç¡®è®¤å é¤
deleteConfirm = function(message) {
    return confirm(message || 'ç¡®å®è¦å é¤åï¼æ­¤æä½ä¸å¯æ¢å¤ï¼');
};

// æ¾ç¤ºæ¨¡ææ¡
showModal = function(modalId) {
    document.getElementById(modalId).classList.add('show');
};

// éèæ¨¡ææ¡
hideModal = function(modalId) {
    document.getElementById(modalId).classList.remove('show');
};

// å³é­æ¨¡ææ¡ï¼ç¹å»é®ç½©å±ï¼
document.addEventListener('click', function(e) {
    if (e.target.classList.contains('modal')) {
        e.target.classList.remove('show');
    }
});

// è¡¨åéªè¯
validateForm = function(formId) {
    var form = document.getElementById(formId);
    var requiredFields = form.querySelectorAll('[required]');
    var isValid = true;
    
    requiredFields.forEach(function(field) {
        if (!field.value.trim()) {
            field.style.borderColor = '#dc3545';
            isValid = false;
        } else {
            field.style.borderColor = '#ddd';
        }
    });
    
    if (!isValid) {
        alert('è¯·å¡«åææå¿å¡«é¡¹');
    }
    
    return isValid;
};

// èªå¨éèæ¶æ¯æç¤º
setTimeout(function() {
    var alerts = document.querySelectorAll('.alert');
    alerts.forEach(function(alert) {
        alert.style.opacity = '0';
        alert.style.transition = 'opacity 0.5s';
        setTimeout(function() {
            alert.style.display = 'none';
        }, 500);
    });
}, 3000);

// è¡¨æ ¼å¨é/å¨ä¸é
toggleSelectAll = function(checkbox, name) {
    var checkboxes = document.querySelectorAll('input[name="' + name + '"]');
    checkboxes.forEach(function(cb) {
        cb.checked = checkbox.checked;
    });
};

// æå°åè½
printPage = function() {
    window.print();
};

// å¯¼åºCSV
exportCSV = function(tableId, filename) {
    var table = document.getElementById(tableId);
    if (!table) return;
    
    var csv = [];
    var rows = table.querySelectorAll('tr');
    
    rows.forEach(function(row) {
        var cols = row.querySelectorAll('td, th');
        var rowData = [];
        cols.forEach(function(col) {
            rowData.push('"' + col.innerText.replace(/"/g, '""') + '"');
        });
        csv.push(rowData.join(','));
    });
    
    var csvContent = '\uFEFF' + csv.join('\n');
    var blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    var link = document.createElement('a');
    
    if (link.download !== undefined) {
        var url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        link.setAttribute('download', filename || 'export.csv');
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }
};

// æç´¢åè½
searchTable = function(inputId, tableId) {
    var input = document.getElementById(inputId);
    var filter = input.value.toUpperCase();
    var table = document.getElementById(tableId);
    var tr = table.getElementsByTagName('tr');
    
    for (var i = 1; i < tr.length; i++) {
        var td = tr[i].getElementsByTagName('td');
        var found = false;
        
        for (var j = 0; j < td.length; j++) {
            if (td[j]) {
                var txtValue = td[j].textContent || td[j].innerText;
                if (txtValue.toUpperCase().indexOf(filter) > -1) {
                    found = true;
                    break;
                }
            }
        }
        
        tr[i].style.display = found ? '' : 'none';
    }
};

// æ¥ææ ¼å¼å
formatDate = function(dateString) {
    if (!dateString) return '-';
    var date = new Date(dateString);
    return date.getFullYear() + '-' + 
           String(date.getMonth() + 1).padStart(2, '0') + '-' + 
           String(date.getDate()).padStart(2, '0') + ' ' +
           String(date.getHours()).padStart(2, '0') + ':' +
           String(date.getMinutes()).padStart(2, '0');
};

// AJAXè¯·æ±
ajax = function(options) {
    var xhr = new XMLHttpRequest();
    xhr.open(options.method || 'GET', options.url, true);
    
    if (options.headers) {
        for (var key in options.headers) {
            xhr.setRequestHeader(key, options.headers[key]);
        }
    }
    
    xhr.onreadystatechange = function() {
        if (xhr.readyState === 4) {
            if (xhr.status === 200) {
                if (options.success) {
                    options.success(xhr.responseText);
                }
            } else {
                if (options.error) {
                    options.error(xhr.statusText);
                }
            }
        }
    };
    
    xhr.send(options.data || null);
};

// å è½½å¨ç»
showLoading = function() {
    var loading = document.createElement('div');
    loading.id = 'global-loading';
    loading.innerHTML = '<div class="loading"></div>';
    loading.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(255,255,255,0.8);display:flex;justify-content:center;align-items:center;z-index:9999;';
    document.body.appendChild(loading);
};

hideLoading = function() {
    var loading = document.getElementById('global-loading');
    if (loading) {
        loading.remove();
    }
};
