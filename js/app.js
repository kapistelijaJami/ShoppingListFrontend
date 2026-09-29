let ws;
let items = [];
let lists = [];

const currentListId = {
    _currentListId: null,
    get value() {
        return this._currentListId
    },
    set value(newValue) {
        this._currentListId = newValue;
        currentListIdChanged();
    }
};
let listLoaded = false;

let copyModeActive = false;
let sourceListId = null;
let sourceItems = [];

//Client-side only marker: id of the last item THIS client ticked/unticked in normal view.
let lastToggledItemId = null;
//Timeout id for auto-removing the marker; the timer restarts with every new toggle.
const LAST_TOGGLE_MARK_MS = 60000;
let lastToggleTimer = null;

const reconnectTimeoutMs = 1000;
let reconnectInstantly = true;
let reconnectTimeout = null;
const DISABLE_DELETE_LIST_ID = 2; //Don't let code delete list with id 2.
const DEFAULT_COPY_SOURCE_LIST_ID = 2;

function initWebSocket() {
    updateStatus(1); //Connecting
    const params = new URLSearchParams(window.location.search);
    currentListId.value = parseListId(params.get('list'));
    const wsUrl = 'wss://' + window.location.hostname + '/wss/kauppalista' + (currentListId.value ? '?list=' + encodeURIComponent(currentListId.value) : '');
    ws = new WebSocket(wsUrl);
    listLoaded = false;

    ws.onopen = function () {
        console.log('Connected to server');
        updateStatus(2); //Connected

        sendMessage({ type: 'getLists' });

        items = [];
        renderList();
    };

    ws.onmessage = function (event) {
        const response = JSON.parse(event.data);
        console.log('Received:', response);

        if (response.type === 'init') {
            items = response.items;
            currentListId.value = parseListId(response.listId);
            setUrlParamsFromList(currentListId.value);
            listLoaded = true;
            renderList();
        } else if (response.type === 'update') {
            handleUpdate(response.action, response.data);
        } else if (response.type === 'error') {
            console.error('Server error:', response.message);
        }
    };

    ws.onerror = function (error) {
        console.error('WebSocket error:', error);
        updateStatus(0); //Disconnected
    };

    ws.onclose = function () {
        console.log('Disconnected from server');
        updateStatus(0); //Disconnected

        if (reconnectInstantly) {
            reconnectInstantly = false;
            if (reconnectTimeout) {
                clearTimeout(reconnectTimeout);
                reconnectTimeout = null;
            }
            setTimeout(initWebSocket, 0);
            reconnectTimeout = setTimeout(() => reconnectInstantly = true, 10000);
        } else {
            setTimeout(initWebSocket, reconnectTimeoutMs);
        }
    };
}

function updateStatus(connectionStatus) {
    const statusEl = document.getElementById('status');
    if (connectionStatus === 2) {
        statusEl.textContent = '✓ Connected';
        statusEl.className = 'status connected';
    } else if (connectionStatus === 1) {
        statusEl.textContent = 'Connecting...';
        statusEl.className = 'status disconnected';
    } else if (connectionStatus === 0) {
        statusEl.textContent = '✗ Disconnected';
        statusEl.className = 'status disconnected';
    }

    disableButtons();
}

function isConnected() {
    return connectionStatus === 2;
}

function disableButtons() {
    const disconnected = !isConnected();

    document.getElementById('itemInput').disabled = disconnected;
    document.getElementById('addBtn').disabled = disconnected;
    document.getElementById('createListBtn').disabled = disconnected;
    document.getElementById('renameListBtn').disabled = disconnected;
    document.getElementById('copyListItemsBtn').disabled = disconnected;
    document.getElementById('copyModeBtn').disabled = disconnected;
    document.getElementById('listSelect').disabled = disconnected;
    document.getElementById('sourceListSelect').disabled = disconnected;
    document.getElementById('targetListSelect').disabled = disconnected;
    document.getElementById('doneCopyBtn').disabled = disconnected;

    const disableDelete = shouldDisableDelete() || disconnected;

    document.getElementById('clearBtn').disabled = disableDelete;
    document.getElementById('deleteListBtn').disabled = disableDelete;
    if (disableDelete) {
        document.getElementById('copyModeBtn').classList.add("hidden");
    } else {
        document.getElementById('copyModeBtn').classList.remove("hidden");
    }

    document.querySelectorAll('.count-btn, .delete-btn, input[type="checkbox"]').forEach(el => el.disabled = disconnected);
}

function sendMessage(data) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(data));
    }
}

function setUrlParamsFromList(listId) {
    const params = new URLSearchParams(window.location.search);
    let newUrl;
    if (listId) {
        params.set('list', listId);
        newUrl = window.location.pathname + '?' + params.toString();
    } else {
        newUrl = window.location.pathname;
    }
    history.replaceState({}, '', newUrl); //replaceState arguments explained here: https://developer.mozilla.org/en-US/docs/Web/API/History/replaceState
}

function addItem() {
    const input = document.getElementById('itemInput');
    const itemName = forceUppercaseOnFirstLetter(input.value.trim());
    if (itemName === '') {
        alert('Please enter an item');
        return;
    }

    sendMessage({ type: 'add', item: itemName, listId: currentListId.value });
    input.value = '';
    input.focus();
}

function toggleItem(id, newState) {
    lastToggledItemId = id; //Remember this client's last ticked/unticked item for the marker

    //Restart the auto-remove timer so the marker fades out a minute after the latest toggle.
    if (lastToggleTimer) {
        clearTimeout(lastToggleTimer);
    }
    lastToggleTimer = setTimeout(clearLastToggleMarker, LAST_TOGGLE_MARK_MS);

    sendMessage({ type: 'toggle', id: id, newState: newState, listId: currentListId.value });
}

function clearLastToggleMarker() {
    lastToggleTimer = null;
    if (lastToggledItemId !== null) {
        lastToggledItemId = null;
        renderList();
    }
}

function changeCount(id, delta) {
    sendMessage({ type: 'count', id: id, delta: delta, listId: currentListId.value });
}

function removeItem(id) {
    if (!confirm('Delete this item?')) return;
    sendMessage({ type: 'remove', id: id, listId: currentListId.value });
}

function isConnected() {
    return ws && ws.readyState === WebSocket.OPEN;
}

function clearList() {
    if (confirm('Are you sure you want to clear all items?')) {
        sendMessage({ type: 'clear', listId: currentListId.value });
    }
}

function createList() {
    let name = prompt('Create new list. Enter name:', getFormattedDate(new Date()));
    if (name?.trim()) {
        name = name.trim();
        const count = countCharacterOccurances(name, 't');
        if (count === name.length) { //Only letters 't'
            const d = new Date();
            d.setDate(d.getDate() + count);
            name = getFormattedDate(d);
        }
        name = forceUppercaseOnFirstLetter(name);
        sendMessage({ type: 'createList', name: name });
    }
}

function getFormattedDate(d) {
    const daysOfWeek = [
        'Sunnuntai', 'Maanantai', 'Tiistai', 'Keskiviikko', 'Torstai', 'Perjantai', 'Lauantai'
    ];

    const dayOfWeek = daysOfWeek[d.getDay()];
    const date = d.getDate();
    const month = d.getMonth() + 1;

    return `${dayOfWeek} ${date}.${month}`;
}

function countCharacterOccurances(str, char) {
    return str.toLowerCase().split(char).length - 1;
}

function deleteCurrentList() {
    if (!currentListId.value) {
        return;
    }
    if (!confirm('Delete this list and all its items?')) {
        return;
    }
    sendMessage({ type: 'deleteList', listId: currentListId.value });
    currentListId.value = null;
    console.log("currentListId set to null");
    listLoaded = false;
    setUrlParamsFromList(null);
}

function renameCurrentList() {
    if (!currentListId.value) {
        return;
    }
    let newName = prompt('Rename current list, enter new name:');
    if (newName?.trim()) {
        newName = forceUppercaseOnFirstLetter(newName.trim());
        sendMessage({ type: 'renameList', listId: currentListId.value, newName: newName });
    }
}

function copyCurrentListItems() {
    if (!currentListId.value) {
        return;
    }

    let result = "";
    items.forEach((item, index, array) => {
        const isLast = index === array.length - 1;

        result += item.name + " (" + item.count + ")";

        if (!isLast) {
            result += ',';
        }
        result += '\n';
    });

    navigator.clipboard.writeText(result).then(() => {
        alert('List items copied to clipboard');
    }).catch(err => {
        console.error('Could not copy text: ', err);
        alert('Failed to copy list items to clipboard');
    });
}

function enterCopyMode() {
    if (!currentListId.value) {
        return;
    }
    copyModeActive = true;
    sourceListId = DEFAULT_COPY_SOURCE_LIST_ID;
    sourceItems = [];

    document.getElementById('list-toolbar').classList.add('hidden');
    document.getElementById('copyToolbar').classList.remove('hidden');
    document.getElementById('normalView').classList.add('hidden');
    document.getElementById('splitView').classList.remove('hidden');

    renderListSelector();
    populateSourceListSelector();
    removePermanentsFromTargetListSelector();
    renderTargetList();
    renderSourceList();
}

function exitCopyMode() {
    copyModeActive = false;
    sourceListId = null;
    sourceItems = [];

    document.getElementById('list-toolbar').classList.remove('hidden');
    document.getElementById('copyToolbar').classList.add('hidden');
    document.getElementById('normalView').classList.remove('hidden');
    document.getElementById('splitView').classList.add('hidden');

    renderList();
}

function populateSourceListSelector() {
    const select = document.getElementById('sourceListSelect');
    const options = lists.filter(list => list.id !== currentListId.value);
    select.innerHTML = options.map(list => `<option value="${list.id}">${list.name}</option>`).join('');

    if (options.length === 0) {
        sourceListId = null;
        sourceItems = [];
        renderSourceList();
        return;
    }

    //Preserve the current source selection if it's still available
    let selectedId = sourceListId;
    if (!selectedId || !options.some(list => list.id === selectedId)) {
        selectedId = parseListId(options[0].id);
    }
    select.value = String(selectedId);
    sourceListId = selectedId;
    loadSourceList(selectedId);
}

function loadSourceList(listId) {
    listId = parseListId(listId);
    if (!listId) {
        return;
    }
    sourceListId = listId;
    sendMessage({ type: 'getItems', listId: listId });
}

function copySourceItem(itemId) {
    const item = sourceItems.find(i => i.id === itemId);
    if (!item) {
        return;
    }
    sendMessage({ type: 'add', item: item.name, listId: currentListId.value });
}

function renderSourceList() {
    const listEl = document.getElementById('sourceList');
    const emptyMessageEl = document.getElementById('sourceEmptyMessage');
    listEl.innerHTML = '';

    if (sourceItems.length === 0) {
        emptyMessageEl.style.display = 'block';
        return;
    } else {
        emptyMessageEl.style.display = 'none';
    }

    const targetNames = new Set(items.map(item => item.name.toLowerCase()));

    sourceItems.slice().sort((a, b) => a.name.localeCompare(b.name, 'fi')).forEach(item => {
        const li = document.createElement('li');
        li.textContent = item.name;
        li.addEventListener('click', () => copySourceItem(item.id));

        if (targetNames.has(item.name.toLowerCase())) {
            li.classList.add('hidden-item');
        }

        listEl.appendChild(li);
    });
}

function renderTargetList() {
    const listEl = document.getElementById('targetList');
    const emptyMessageEl = document.getElementById('targetEmptyMessage');
    listEl.innerHTML = '';

    if (items.length === 0) {
        emptyMessageEl.style.display = 'block';
        return;
    } else {
        emptyMessageEl.style.display = 'none';
    }

    items.slice().sort((a, b) => a.name.localeCompare(b.name, 'fi')).forEach(item => {
        const li = document.createElement('li');

        const div = document.createElement('div');
        div.className = 'target-text';
        div.textContent = item.name;

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'delete-btn';
        deleteBtn.textContent = '✕';
        deleteBtn.addEventListener('click', () => removeItem(item.id));

        li.appendChild(div);
        li.appendChild(deleteBtn);
        listEl.appendChild(li);
    });
}

function switchList(listId) {
    listId = parseListId(listId);
    if (!listId) {
        return;
    }
    currentListId.value = listId;

    if (ws && ws.readyState === WebSocket.OPEN) {
        sendMessage({ type: 'get', listId: listId });
    }

    if (copyModeActive) {
        populateSourceListSelector();
        renderTargetList();
        renderSourceList();
    } else {
        renderList();
    }
    renderListSelector();
}

function parseListId(value) {
    if (value === null || value === undefined || value === '') {
        return null;
    }
    const id = typeof value === 'number' ? value : parseInt(value, 10);
    return Number.isInteger(id) && id > 0 ? id : null;
}

function handleUpdate(action, data) {
    switch (action) {
        case 'add':
            items.push(data);
            break;
        case 'addMultiple':
            if (Array.isArray(data)) {
                items = items.concat(data);
            }
            break;
        case 'remove':
            items = items.filter(item => item.id !== data.id);
            break;
        case 'toggle':
            const toggledItem = items.find(i => i.id === data.id);
            if (toggledItem) {
                toggledItem.completed = data.completed;
            }
            break;
        case 'count':
            const countedItem = items.find(i => i.id === data.id);
            if (countedItem) {
                countedItem.count = data.count;
            }
            break;
        case 'clients':
            document.getElementById('clientCount').textContent = data.count;
            break;
        case 'clear':
            items = [];
            break;
        case 'list':
            const listId = parseListId(data.listId);
            //If in copy mode and this is the source list's items, treat as source items
            if (copyModeActive && listId === sourceListId) {
                sourceItems = data.items || [];
                renderSourceList();
                break;
            }
            items = data.items;
            sortItems();
            listLoaded = true;
            currentListId.value = listId;
            setUrlParamsFromList(currentListId.value);
            break;
        case 'sourceItems':
            sourceItems = data.items || [];
            renderSourceList();
            break;
        case 'lists':
            lists = data.lists || [];
            renderListSelector();
            if (listLoaded) {
                break;
            }
            if (!currentListId.value) {
                requestFirstList();
            } else if (currentListId.value) {
                sendMessage({ type: 'get', listId: currentListId.value });
            }
            break;
        case 'listsUpdate':
            console.log("In listsUpdate");
            lists = data.lists || [];
            //If the list you were looking at was deleted we have to request another list
            console.log("Checking if currentListId is found in lists:", currentListId.value, lists);
            if (!lists.some(list => list.id === currentListId.value)) { //currentListId doesn't match to any list
                requestFirstList();
            }
            if (copyModeActive) {
                populateSourceListSelector();
            }
            renderListSelector();
            break;
        case 'listCreated':
            switchList(data.id);
            break;
    }

    if (copyModeActive) {
        renderTargetList();
        renderSourceList();
    } else {
        renderList();
    }
}

function requestFirstList() {
    console.log("requesting first list");
    if (lists.length === 0) {
        return;
    }
    currentListId.value = parseListId(lists[0].id);

    console.log("url params set to:", currentListId.value);
    setUrlParamsFromList(currentListId.value);

    console.log("sending get on first list:", currentListId.value);
    sendMessage({ type: 'get', listId: currentListId.value });
}

function renderListSelector() {
    const select = document.getElementById('listSelect');
    const options = lists.length ? lists : [];
    select.innerHTML = options.map(list => `<option value="${list.id}" ${list.id === currentListId.value ? 'selected' : ''}>${list.name}</option>`).join('');

    if (currentListId.value && select.value !== String(currentListId.value)) {
        select.value = String(currentListId.value);
    }

    //Also populate the target selector in copy mode
    const targetSelect = document.getElementById('targetListSelect');
    if (targetSelect) {
        targetSelect.innerHTML = options.filter(list => list.id !== DISABLE_DELETE_LIST_ID).map(list => `<option value="${list.id}" ${list.id === currentListId.value ? 'selected' : ''}>${list.name}</option>`).join('');
        if (currentListId.value && targetSelect.value !== String(currentListId.value)) {
            targetSelect.value = String(currentListId.value);
        }
    }

    setUrlParamsFromList(currentListId.value);
}

function renderList() {
    const listEl = document.getElementById('shoppingList');
    const emptyMessageEl = document.getElementById('emptyMessage');

    const firstTops = new Map();
    items.forEach(item => {
        const el = listEl.querySelector(`[data-id="${item.id}"]`);
        if (el) {
            firstTops.set(item.id, el.getBoundingClientRect().top);
        }
    });

    listEl.innerHTML = '';

    if (items.length === 0) {
        emptyMessageEl.style.display = 'block';
        document.getElementsByClassName("items-total-text")[0].classList.add("hidden");
        return;
    } else {
        emptyMessageEl.style.display = 'none';
        document.getElementsByClassName("items-total-text")[0].classList.remove("hidden");
    }

    document.getElementById("itemsTotal").innerText = items.length;

    sortItems();

    items.forEach(item => {
        const li = document.createElement('li');
        li.setAttribute('data-id', item.id);
        li.className = 'item';

        //Highlight the last item this client ticked/unticked
        if (item.id === lastToggledItemId) {
            li.classList.add('last-toggled');
        }

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = item.completed;
        checkbox.addEventListener('click', () => toggleItem(item.id, !item.completed));

        const itemName = document.createElement('span');
        itemName.className = 'item-name';
        itemName.textContent = item.name;

        const itemCount = document.createElement('div');
        itemCount.className = 'item-count';

        const countMinus = document.createElement('button');
        countMinus.className = 'count-btn';
        countMinus.textContent = '-';
        countMinus.addEventListener('click', () => {
            if (item.count === 1) {
                return;
            }
            changeCount(item.id, -1);
        });

        const countSpan = document.createElement('span');
        countSpan.textContent = item.count || 1;

        const countPlus = document.createElement('button');
        countPlus.className = 'count-btn';
        countPlus.textContent = '+';
        countPlus.addEventListener('click', () => changeCount(item.id, 1));

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'delete-btn';
        deleteBtn.textContent = '✕';
        deleteBtn.addEventListener('click', () => removeItem(item.id));

        itemCount.appendChild(countMinus);
        itemCount.appendChild(countSpan);
        itemCount.appendChild(countPlus);
        li.appendChild(checkbox);
        li.appendChild(itemName);
        li.appendChild(itemCount);
        li.appendChild(deleteBtn);
        listEl.appendChild(li);
    });

    listEl.style.pointerEvents = 'none';

    //FLIP animation
    let somethingChanged = false;
    items.forEach(item => {
        const oldTop = firstTops.get(item.id);
        if (oldTop !== undefined) {
            const li = document.querySelector(`[data-id="${item.id}"]`);
            const newTop = li.getBoundingClientRect().top;
            if (oldTop === newTop) {
                return;
            }
            const delta = oldTop - newTop;
            somethingChanged = true;
            li.style.transition = 'none';
            li.style.transform = `translateY(${delta}px)`;
            li.getBoundingClientRect(); //Force reflow between css changes
            requestAnimationFrame(() => {
                li.style.transition = 'transform 0.3s ease';
                li.style.transform = '';
            });
        }
    });

    clearTimeout(renderList._t);
    if (somethingChanged) {
        renderList._t = setTimeout(() => { listEl.style.pointerEvents = ''; }, 300);
    } else {
        listEl.style.pointerEvents = '';
    }
}

function sortItems() {
    items.sort((a, b) => {
        if (a.completed !== b.completed) {
            return Number(a.completed) - Number(b.completed);
        }

        //If want to sort by creation time
        /*if (a.timestamp !== b.timestamp) {
            return new Date(a.timestamp) - new Date(b.timestamp);
        }*/

        return a.name.localeCompare(b.name, 'fi');
    });
}

function toggleMenu(event) {
    event.stopPropagation();
    const menu = document.getElementById('listMenu');
    if (menu.classList.contains("hidden")) {
        menu.classList.remove("hidden");
    } else {
        menu.classList.add("hidden");
    }
}

function currentListIdChanged() {
    //Marker is per-list; reset it (and its timer) whenever the current list changes
    if (lastToggleTimer) {
        clearTimeout(lastToggleTimer);
        lastToggleTimer = null;
    }
    lastToggledItemId = null;
    disableButtons();
}

function shouldDisableDelete() {
    return currentListId.value === DISABLE_DELETE_LIST_ID;
}

function forceUppercaseOnFirstLetter(text) {
    return text.charAt(0).toUpperCase() + text.slice(1);
}

function setupEventListeners() {
    document.getElementById('listSelect').addEventListener('change', (event) => {
        switchList(event.target.value);
    });

    document.getElementById('copyModeBtn').addEventListener('click', enterCopyMode);

    document.getElementById('listMenuBtn').addEventListener('click', toggleMenu);

    document.getElementById('createListBtn').addEventListener('click', createList);

    document.getElementById('renameListBtn').addEventListener('click', renameCurrentList);

    document.getElementById('copyListItemsBtn').addEventListener('click', copyCurrentListItems);

    document.getElementById('deleteListBtn').addEventListener('click', deleteCurrentList);

    document.getElementById('sourceListSelect').addEventListener('change', (event) => {
        loadSourceList(event.target.value);
    });

    document.getElementById('targetListSelect').addEventListener('change', (event) => {
        switchList(event.target.value);
    });

    document.getElementById('doneCopyBtn').addEventListener('click', exitCopyMode);

    document.querySelector('.input-group form').addEventListener('submit', (event) => {
        event.preventDefault();
        addItem();
    });

    document.getElementById('clearBtn').addEventListener('click', clearList);

    document.addEventListener('click', (event) => {
        const menu = document.getElementById('listMenu');
        if (menu && !menu.classList.contains("hidden")) {
            menu.classList.add("hidden");
        }
    });
}

window.addEventListener('load', () => {
    setupEventListeners();
    initWebSocket();
});
