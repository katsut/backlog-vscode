// @ts-check
/// <reference path="./vscode-webview.d.ts" />

// Get VS Code API
const vscode = acquireVsCodeApi();

(function() {
	const loadingElement = document.getElementById('loading');
	const issueContainer = document.getElementById('issue-container');
	
	// Listen for messages from the extension
	window.addEventListener('message', event => {
		const message = event.data;
		
		switch (message.type) {
			case 'showIssue':
				showIssue(message.issue, message.comments);
				break;
		}
	});
	
	// Set up open in browser button
	const openInBrowserButton = document.getElementById('open-in-browser');
	if (openInBrowserButton) {
		openInBrowserButton.addEventListener('click', () => {
			const currentIssue = getCurrentIssue();
			if (currentIssue) {
				// Construct Backlog URL from issue key
				const apiUrl = getApiUrlFromState();
				if (apiUrl) {
					const baseUrl = apiUrl.replace(/\/api\/v2\/?$/, '');
					const issueUrl = `${baseUrl}/view/${currentIssue.issueKey}`;
					vscode.postMessage({
						type: 'openInBrowser',
						url: issueUrl
					});
				}
			}
		});
	}
	
	/** @type {BacklogIssue | null} */
	let currentIssue = null;
	/** @type {string | null} */
	let currentApiUrl = null;
	
	/**
	 * @returns {BacklogIssue | null}
	 */
	function getCurrentIssue() {
		return currentIssue;
	}
	
	/**
	 * @returns {string | null}
	 */
	function getApiUrlFromState() {
		return currentApiUrl;
	}
	
	/**
	 * @param {BacklogIssue} issue
	 * @param {BacklogComment[]} comments
	 */
	function showIssue(issue, comments) {
		currentIssue = issue;
		
		// Hide loading and show issue container
		if (loadingElement) {
			loadingElement.style.display = 'none';
		}
		if (issueContainer) {
			issueContainer.style.display = 'block';
		}
		
		// Update issue details
		updateElement('issue-title', issue.summary);
		updateElement('issue-key', issue.issueKey);
		updateStatusBadge(issue.status);
		updatePriorityBadge(issue.priority);
		updateElement('issue-assignee', issue.assignee ? issue.assignee.name : 'Unassigned');
		updateElement('issue-created', formatDate(issue.created));
		updateElement('issue-updated', formatDate(issue.updated));
		updateElement('issue-due-date', issue.dueDate ? formatDate(issue.dueDate) : 'Not set');
		updateElement('issue-description-content', issue.description || 'No description provided');
		
		// Update comments
		updateComments(comments);
	}
	
	/**
	 * @param {string} id
	 * @param {string} content
	 */
	function updateElement(id, content) {
		const element = document.getElementById(id);
		if (element) {
			element.textContent = content;
		}
	}
	
	/**
	 * @param {BacklogStatus} status
	 */
	function updateStatusBadge(status) {
		const statusElement = document.getElementById('issue-status');
		if (statusElement) {
			statusElement.textContent = status.name;
			statusElement.className = 'status-badge ' + getStatusClass(status.name);
		}
	}
	
	/**
	 * @param {BacklogPriority} priority
	 */
	function updatePriorityBadge(priority) {
		const priorityElement = document.getElementById('issue-priority');
		if (priorityElement) {
			priorityElement.textContent = priority.name;
			priorityElement.className = 'priority-badge ' + getPriorityClass(priority.name);
		}
	}
	
	/**
	 * @param {string} statusName
	 * @returns {string}
	 */
	function getStatusClass(statusName) {
		const name = statusName.toLowerCase();
		if (name.includes('open') || name.includes('オープン')) {
			return 'open';
		} else if (name.includes('progress') || name.includes('処理中')) {
			return 'in-progress';
		} else if (name.includes('resolved') || name.includes('解決')) {
			return 'resolved';
		} else if (name.includes('closed') || name.includes('クローズ')) {
			return 'closed';
		}
		return '';
	}
	
	/**
	 * @param {string} priorityName
	 * @returns {string}
	 */
	function getPriorityClass(priorityName) {
		const name = priorityName.toLowerCase();
		if (name.includes('high') || name.includes('高')) {
			return 'high';
		} else if (name.includes('medium') || name.includes('中')) {
			return 'medium';
		} else if (name.includes('low') || name.includes('低')) {
			return 'low';
		}
		return '';
	}
	
	/**
	 * @param {BacklogComment[]} comments
	 */
	function updateComments(comments) {
		const commentsContainer = document.getElementById('comments-container');
		if (!commentsContainer) return;
		
		// Clear existing comments
		commentsContainer.innerHTML = '';
		
		if (!comments || comments.length === 0) {
			const emptyState = document.createElement('div');
			emptyState.className = 'empty-state';
			emptyState.textContent = 'No comments yet';
			commentsContainer.appendChild(emptyState);
			return;
		}
		
		// Add comments
		comments.forEach(comment => {
			const commentElement = createCommentElement(comment);
			commentsContainer.appendChild(commentElement);
		});
	}
	
	/**
	 * @param {BacklogComment} comment
	 * @returns {HTMLDivElement}
	 */
	function createCommentElement(comment) {
		const commentDiv = document.createElement('div');
		commentDiv.className = 'comment';
		
		const header = document.createElement('div');
		header.className = 'comment-header';
		
		const author = document.createElement('span');
		author.className = 'comment-author';
		author.textContent = comment.createdUser ? comment.createdUser.name : 'Unknown';
		
		const date = document.createElement('span');
		date.className = 'comment-date';
		date.textContent = formatDate(comment.created);
		
		header.appendChild(author);
		header.appendChild(date);
		
		const content = document.createElement('div');
		content.className = 'comment-content';
		content.textContent = comment.content || '';
		
		commentDiv.appendChild(header);
		commentDiv.appendChild(content);
		
		return commentDiv;
	}
	
	/**
	 * @param {string} dateString
	 * @returns {string}
	 */
	function formatDate(dateString) {
		if (!dateString) return '';
		
		try {
			const date = new Date(dateString);
			return date.toLocaleString();
		} catch (error) {
			return dateString; // Return original string if parsing fails
		}
	}
})();
