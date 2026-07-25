import { BaseAdapterPlugin } from './base.adapter';
import type { AdapterCapability, PluginContext } from '../plugin-types';
import { createLogger } from '@extension/shared/lib/logger';

const logger = createLogger('QianwenAdapter');

export class QianwenAdapter extends BaseAdapterPlugin {
  readonly name = 'QianwenAdapter';
  readonly version = '1.0.0';
  readonly hostnames = ['qianwen.com', 'www.qianwen.com', 'tongyi.com'];
  readonly capabilities: AdapterCapability[] = [
    'text-insertion',
    'form-submission',
    'file-attachment',
    'dom-manipulation'
  ];

  private readonly selectors = {
    CHAT_INPUT: [
      '[contenteditable="true"]',
      'div[data-slate-editor="true"]',
      'div[role="textbox"][data-slate-editor="true"]',
      'textarea.message-input-textarea',
      '#chat-input',
      'textarea.chat-input',
      'div[contenteditable="true"][role="textbox"]',
      'textarea[placeholder*="输入"]',
      'textarea[placeholder*="Message"]',
    ].join(', '),
    SUBMIT_BUTTON: [
      'button.omni-button-content-btn',
      'div.message-input-right-button-send button',
      'button.send-button',
      'div.chat-prompt-send-button button',
      '#send-message-button',
      'button[aria-label*="发送"]',
      'button[title*="发送"]',
      'button[aria-label*="Send"]',
      'button[type="submit"]',
      'form button[type="submit"]',
      'div.send-button-container button'
    ].join(', '),
    FILE_UPLOAD_BUTTON: [
      'div.mode-select .ant-dropdown-trigger',
      'div.mode-select-open',
      'button.chat-prompt-upload-group-btn',
      'div.upload-group button',
      'button[aria-label*="上传"]',
      'button[aria-label*="Upload"]',
      'button[title*="上传"]',
      'button[aria-label*="Attach"]',
      'button[aria-label*="attachment"]',
      'div.file-upload-btn button',
      'input[type="file"] + label'
    ].join(', '),
    FILE_INPUT: 'input#filesUpload, input[type="file"][multiple], input[type="file"][accept], input[type="file"]',
    MAIN_PANEL: [
      'div.message-input-container',
      'div.message-input-container-area',
      'div.prompt-input-container',
      'div.input-area',
      'div.chat-input-area',
      'div.message-input-area',
      'form.chat-form',
      'form.message-form'
    ].join(', '),
    DROP_ZONE: [
      'textarea.message-input-textarea',
      'textarea#chat-input',
      'textarea.chat-input',
      'div.drop-zone',
      '[data-dropzone]',
      '[data-slate-editor="true"]',
      '[data-chat-input-body="true"]'
    ].join(', '),
    FILE_PREVIEW: 'div.prompt-input-file-list, div.file-preview, div.attachment-list',
    BUTTON_INSERTION_CONTAINER: [
      'div.message-input-right-button',
      'div.action-bar-left-btns',
      'div.action-bar-left',
      'div.toolbar',
      'div.control-bar',
      'div.action-bar',
      'div.button-group',
      'div.action-buttons',
      'div.toolbar-container',
      'div.controls'
    ].join(', '),
    ACTION_BAR: 'div.message-input-container-area, div.prompt-input-action-bar, div.action-bar, div.toolbar',
    FALLBACK_INSERTION: [
      'div.message-input-container-area',
      'div.prompt-input-action-bar',
      '#chat-input',
      'div.input-area',
      'form.chat-form',
      'textarea.chat-input'
    ].join(', '),
  };

  private lastUrl: string = '';
  private urlCheckInterval: NodeJS.Timeout | null = null;
  private mcpPopoverContainer: HTMLElement | null = null;
  private mutationObserver: MutationObserver | null = null;
  private popoverCheckInterval: NodeJS.Timeout | null = null;
  private storeEventListenersSetup: boolean = false;
  private domObserversSetup: boolean = false;
  private uiIntegrationSetup: boolean = false;
  private adapterStylesInjected: boolean = false;

  constructor() {
    super();
    logger.debug('QianwenAdapter instance created');
  }

  async initialize(context: PluginContext): Promise<void> {
    if (this.currentStatus === 'initializing' || this.currentStatus === 'active') {
      context.logger.warn('QianwenAdapter already initialized or active, skipping');
      return;
    }
    await super.initialize(context);
    this.context.logger.debug('Initializing QianwenAdapter...');
    this.lastUrl = window.location.href;
    this.setupUrlTracking();
    this.setupStoreEventListeners();
  }

  async activate(): Promise<void> {
    if (this.currentStatus === 'active') {
      this.context?.logger.warn('QianwenAdapter already active, skipping re-activation');
      return;
    }
    await super.activate();
    this.context.logger.debug('Activating QianwenAdapter...');
    this.injectQwenButtonStyles();
    this.setupDOMObservers();
    this.setupUIIntegration();
    this.context.eventBus.emit('adapter:activated', { pluginName: this.name, timestamp: Date.now() });
  }

  async deactivate(): Promise<void> {
    if (this.currentStatus === 'inactive' || this.currentStatus === 'disabled') {
      this.context?.logger.warn('QianwenAdapter already inactive, skipping deactivation');
      return;
    }
    await super.deactivate();
    this.context.logger.debug('Deactivating QianwenAdapter...');
    this.cleanupUIIntegration();
    this.cleanupDOMObservers();
    this.storeEventListenersSetup = false;
    this.domObserversSetup = false;
    this.uiIntegrationSetup = false;
    this.context.eventBus.emit('adapter:deactivated', { pluginName: this.name, timestamp: Date.now() });
  }

  async cleanup(): Promise<void> {
    await super.cleanup();
    this.context.logger.debug('Cleaning up QianwenAdapter...');
    if (this.urlCheckInterval) { clearInterval(this.urlCheckInterval); this.urlCheckInterval = null; }
    if (this.popoverCheckInterval) { clearInterval(this.popoverCheckInterval); this.popoverCheckInterval = null; }
    const styleElement = document.getElementById('mcp-qianwen-button-styles');
    if (styleElement) { styleElement.remove(); this.adapterStylesInjected = false; }
    this.cleanupUIIntegration();
    this.cleanupDOMObservers();
  }
  async insertText(text: string, options?: { targetElement?: HTMLElement }): Promise<boolean> {
    this.context.logger.debug(
      `Attempting to insert text into Qianwen chat input: ${text.substring(0, 50)}${text.length > 50 ? '...' : ''}`,
    );
    try {
      const editor = document.querySelector(this.selectors.CHAT_INPUT) as HTMLElement;
      if (!editor) {
        this.emitExecutionFailed('insertText', 'Chat input element not found');
        return false;
      }
      editor.focus();
      const dataTransfer = new DataTransfer();
      dataTransfer.setData('text/plain', text);
      const pasteEvent = new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
        clipboardData: dataTransfer,
      });
      editor.dispatchEvent(pasteEvent);
      this.emitExecutionCompleted('insertText', { text }, { success: true, method: 'clipboard-paste' });
      this.context.logger.debug('Text inserted successfully via clipboard paste');
      return true;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.context.logger.error(`Error inserting text: ${errorMessage}`);
      this.emitExecutionFailed('insertText', errorMessage);
      return false;
    }
  }

  async submitForm(options?: { formElement?: HTMLFormElement }): Promise<boolean> {
    this.context.logger.debug('Attempting to submit Qianwen chat input');
    try {
      const result = await this.clickBySelector(this.selectors.SUBMIT_BUTTON);
      if (result) {
        this.emitExecutionCompleted('submitForm', {}, { success: true, method: 'page-controller' });
      } else {
        this.context.logger.warn('Submit button click failed, falling back to Enter key');
        return this.submitWithEnterKey();
      }
      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.context.logger.error(`Error submitting: ${errorMessage}, falling back to Enter key`);
      return this.submitWithEnterKey();
    }
  }

  private async submitWithEnterKey(): Promise<boolean> {
    try {
      const chatInput = document.querySelector(this.selectors.CHAT_INPUT) as HTMLElement;
      if (!chatInput) {
        this.emitExecutionFailed('submitForm', 'Chat input element not found for Enter key fallback');
        return false;
      }
      chatInput.focus();
      const enterEvents = ['keydown', 'keypress', 'keyup'];
      for (const eventType of enterEvents) {
        chatInput.dispatchEvent(new KeyboardEvent(eventType, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
      }
      this.emitExecutionCompleted('submitForm', {}, { success: true, method: 'enterKey' });
      return true;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.context.logger.error(`Error submitting with Enter key: ${errorMessage}`);
      this.emitExecutionFailed('submitForm', errorMessage);
      return false;
    }
  }

  async attachFile(file: File, options?: { inputElement?: HTMLInputElement }): Promise<boolean> {
    this.context.logger.debug(`Attempting to attach file: ${file.name} (${file.size} bytes, ${file.type})`);
    try {
      if (!file || file.size === 0) { this.emitExecutionFailed('attachFile', 'Invalid file'); return false; }
      if (!this.supportsFileUpload()) { this.emitExecutionFailed('attachFile', 'File upload not supported'); return false; }
      const success1 = await this.attachFileViaDragDrop(file);
      if (success1) { this.emitExecutionCompleted('attachFile', { fileName: file.name }, { success: true, method: 'drag-drop' }); return true; }
      const success2 = await this.attachFileViaInput(file);
      if (success2) { this.emitExecutionCompleted('attachFile', { fileName: file.name }, { success: true, method: 'file-input' }); return true; }
      const success3 = await this.attachFileViaClipboard(file);
      this.emitExecutionCompleted('attachFile', { fileName: file.name }, { success: success3, method: 'clipboard' });
      return success3;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.context.logger.error(`Error attaching file: ${errorMessage}`);
      this.emitExecutionFailed('attachFile', errorMessage);
      return false;
    }
  }

  private async attachFileViaInput(file: File): Promise<boolean> {
    try {
      const fileInput = document.querySelector(this.selectors.FILE_INPUT) as HTMLInputElement;
      if (!fileInput) return false;
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);
      fileInput.files = dataTransfer.files;
      fileInput.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    } catch (error) { this.context.logger.debug(`File input method failed: ${error}`); return false; }
  }

  private async attachFileViaDragDrop(file: File): Promise<boolean> {
    try {
      const dropTarget = document.querySelector(this.selectors.DROP_ZONE) as HTMLElement;
      if (!dropTarget) return false;
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);
      const events = ['dragenter', 'dragover', 'drop'].map(type => new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer }));
      const preventDefaultHandler = (e: Event) => { e.preventDefault(); e.stopPropagation(); };
      dropTarget.addEventListener('dragenter', preventDefaultHandler, { once: true });
      dropTarget.addEventListener('dragover', preventDefaultHandler, { once: true });
      dropTarget.addEventListener('drop', preventDefaultHandler, { once: true });
      for (const event of events) { dropTarget.dispatchEvent(event); await new Promise(r => setTimeout(r, 50)); }
      return true;
    } catch (error) { this.context.logger.debug(`Drag-drop method failed: ${error}`); return false; }
  }

  private async attachFileViaClipboard(file: File): Promise<boolean> {
    try {
      await navigator.clipboard.write([new ClipboardItem({ [file.type]: file })]);
      const chatInput = document.querySelector(this.selectors.CHAT_INPUT) as HTMLElement;
      if (chatInput) chatInput.focus();
      return true;
    } catch (error) { this.context.logger.debug(`Clipboard method failed: ${error}`); return false; }
  }
  isSupported(): boolean | Promise<boolean> {
    const currentHost = window.location.hostname;
    const currentUrl = window.location.href;
    const isQianwenHost = this.hostnames.some(hostname => {
      if (typeof hostname === 'string') return currentHost.includes(hostname);
      return (hostname as RegExp).test(currentHost);
    });
    if (!isQianwenHost) return false;
    const supportedPatterns = [/^https:\/\/(?:www\.)?(?:qianwen|tongyi)\.com\/.*/];
    return supportedPatterns.some(pattern => pattern.test(currentUrl));
  }

  supportsFileUpload(): boolean {
    const fileInput = document.querySelector(this.selectors.FILE_INPUT);
    if (fileInput) return true;
    const uploadButton = document.querySelector(this.selectors.FILE_UPLOAD_BUTTON);
    if (uploadButton) return true;
    const dropZone = document.querySelector(this.selectors.DROP_ZONE);
    if (dropZone) return true;
    return false;
  }

  private emitExecutionCompleted(toolName: string, parameters: any, result: any): void {
    this.context.eventBus.emit('tool:execution-completed', { execution: { id: this.generateCallId(), toolName, parameters, result, timestamp: Date.now(), status: 'success' } });
  }

  private emitExecutionFailed(toolName: string, error: string): void {
    this.context.eventBus.emit('tool:execution-failed', { toolName, error, callId: this.generateCallId() });
  }

  private generateCallId(): string {
    return `qianwen-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
  }

  private setupUrlTracking(): void {
    if (!this.urlCheckInterval) {
      this.urlCheckInterval = setInterval(() => {
        const currentUrl = window.location.href;
        if (currentUrl !== this.lastUrl) {
          this.context.logger.debug(`URL changed from ${this.lastUrl} to ${currentUrl}`);
          if (this.onPageChanged) { this.onPageChanged(currentUrl, this.lastUrl); }
          this.lastUrl = currentUrl;
        }
      }, 1000);
    }
  }

  private setupStoreEventListeners(): void {
    if (this.storeEventListenersSetup) { this.context.logger.warn('Store event listeners already set up, skipping'); return; }
    this.context.logger.debug('Setting up store event listeners for QianwenAdapter');
    this.context.eventBus.on('tool:execution-completed', data => { this.context.logger.debug('Tool execution completed:', data); this.handleToolExecutionCompleted(data); });
    this.context.eventBus.on('ui:sidebar-toggle', data => { this.context.logger.debug('Sidebar toggled:', data); });
    this.storeEventListenersSetup = true;
  }

  private handleToolExecutionCompleted(data: any): void {
    if (!this.shouldHandleEvents()) return;
    const uiState = this.context.stores.ui;
    if (uiState && data.execution) { this.context.logger.debug('Tool execution handled with new architecture integration'); }
  }

  private setupDOMObservers(): void {
    if (this.domObserversSetup) { this.context.logger.warn('DOM observers already set up, skipping'); return; }
    this.context.logger.debug('Setting up DOM observers for QianwenAdapter');
    this.mutationObserver = new MutationObserver(mutations => {
      let shouldReinject = false;
      mutations.forEach(mutation => {
        if (mutation.type === 'childList') {
          if (!document.getElementById('mcp-popover-container')) { shouldReinject = true; }
        }
      });
      if (shouldReinject) {
        const insertionPoint = this.findButtonInsertionPoint();
        if (insertionPoint) { this.context.logger.debug('MCP popover removed, attempting to re-inject'); this.setupUIIntegration(); }
      }
    });
    this.mutationObserver.observe(document.body, { childList: true, subtree: true });
    this.domObserversSetup = true;
  }

  private cleanupDOMObservers(): void {
    this.context.logger.debug('Cleaning up DOM observers for QianwenAdapter');
    if (this.mutationObserver) { this.mutationObserver.disconnect(); this.mutationObserver = null; }
  }

  private setupUIIntegration(): void {
    if (this.uiIntegrationSetup) { this.context.logger.debug('UI integration already set up, re-injecting for page changes'); }
    else { this.context.logger.debug('Setting up UI integration for QianwenAdapter'); this.uiIntegrationSetup = true; }
    this.waitForPageReady().then(() => { this.injectMCPPopoverWithRetry(); }).catch(error => { this.context.logger.warn('Failed to wait for page ready:', error); });
  }

  private async waitForPageReady(): Promise<void> {
    return new Promise((resolve, reject) => {
      let attempts = 0;
      const maxAttempts = 10;
      const checkReady = () => {
        attempts++;
        const insertionPoint = this.findButtonInsertionPoint();
        if (insertionPoint) { this.context.logger.debug('Page ready for MCP popover injection'); resolve(); }
        else if (attempts >= maxAttempts) { this.context.logger.warn('Page ready check timed out'); reject(new Error('No insertion point found after maximum attempts')); }
        else { setTimeout(checkReady, 500); }
      };
      setTimeout(checkReady, 100);
    });
  }

  private injectMCPPopoverWithRetry(maxRetries: number = 5): void {
    const attemptInjection = (attempt: number) => {
      this.context.logger.debug(`Attempting MCP popover injection (attempt ${attempt}/${maxRetries})`);
      if (document.getElementById('mcp-popover-container')) { this.context.logger.debug('MCP popover already exists'); return; }
      const insertionPoint = this.findButtonInsertionPoint();
      if (insertionPoint) { this.injectMCPPopover(insertionPoint); }
      else if (attempt < maxRetries) { this.context.logger.debug(`Insertion point not found, retrying (attempt ${attempt}/${maxRetries})`); setTimeout(() => attemptInjection(attempt + 1), 1000); }
      else { this.context.logger.warn('Failed to inject MCP popover after maximum retries'); }
    };
    attemptInjection(1);
  }
  private findButtonInsertionPoint(): { container: Element; insertAfter: Element | null; insertBefore?: Element | null } | null {
    this.context.logger.debug('Finding button insertion point for MCP popover');
    const containerSelectors = this.selectors.BUTTON_INSERTION_CONTAINER.split(', ');
    for (const selector of containerSelectors) {
      const container = document.querySelector(selector.trim());
      if (container) {
        this.context.logger.debug(`Found insertion container: ${selector.trim()}`);
        const lastChild = container.lastElementChild;
        if (lastChild) { return { container, insertAfter: null, insertBefore: lastChild }; }
        return { container, insertAfter: null };
      }
    }
    const actionBarSelectors = this.selectors.ACTION_BAR.split(', ');
    for (const selector of actionBarSelectors) {
      const actionBar = document.querySelector(selector.trim());
      if (actionBar) {
        this.context.logger.debug(`Found action bar: ${selector.trim()}`);
        const lastChild = actionBar.lastElementChild;
        if (lastChild) { return { container: actionBar, insertAfter: null, insertBefore: lastChild }; }
        return { container: actionBar, insertAfter: null };
      }
    }
    const submitButton = document.querySelector(this.selectors.SUBMIT_BUTTON);
    if (submitButton) {
      const container = submitButton.parentElement;
      if (container) { this.context.logger.debug('Found submit button container'); return { container, insertAfter: null, insertBefore: submitButton }; }
    }
    const fallbackSelectors = this.selectors.FALLBACK_INSERTION.split(', ');
    for (const selector of fallbackSelectors) {
      const container = document.querySelector(selector.trim());
      if (container) { this.context.logger.debug(`Found fallback container: ${selector.trim()}`); return { container, insertAfter: null }; }
    }
    this.context.logger.debug('Could not find suitable insertion point for MCP popover');
    return null;
  }

  private injectMCPPopover(insertionPoint: { container: Element; insertAfter: Element | null; insertBefore?: Element | null }): void {
    this.context.logger.debug('Injecting MCP popover into Qianwen interface');
    try {
      if (document.getElementById('mcp-popover-container')) { this.context.logger.debug('MCP popover already exists, skipping injection'); return; }
      const reactContainer = document.createElement('div');
      reactContainer.id = 'mcp-popover-container';
      reactContainer.style.display = 'inline-flex';
      reactContainer.style.margin = '0 8px 0 0';
      const { container, insertAfter, insertBefore } = insertionPoint;
      if (insertBefore && insertBefore.parentNode === container) { container.insertBefore(reactContainer, insertBefore); this.context.logger.debug('Inserted popover container before specified element'); }
      else if (insertAfter && insertAfter.parentNode === container) { container.insertBefore(reactContainer, insertAfter.nextSibling); this.context.logger.debug('Inserted popover container after specified element'); }
      else { container.appendChild(reactContainer); this.context.logger.debug('Appended popover container to container element'); }
      this.mcpPopoverContainer = reactContainer;
      this.renderMCPPopover(reactContainer);
      this.context.logger.debug('MCP popover injected and rendered successfully');
    } catch (error) { this.context.logger.error('Failed to inject MCP popover:', error); }
  }

  private renderMCPPopover(container: HTMLElement): void {
    this.context.logger.debug('Rendering MCP popover with new architecture integration');
    try {
      import('react').then(React => {
        import('react-dom/client').then(ReactDOM => {
          import('../../components/mcpPopover/mcpPopover').then(({ MCPPopover }) => {
            const toggleStateManager = this.createToggleStateManager();
            const adapterButtonConfig = { className: 'mcp-qianwen-button-base', contentClassName: 'mcp-qianwen-button-content', textClassName: 'mcp-qianwen-button-text', activeClassName: 'mcp-button-active' };
            const root = ReactDOM.createRoot(container);
            root.render(React.createElement(MCPPopover, { toggleStateManager: toggleStateManager, adapterButtonConfig: adapterButtonConfig, adapterName: this.name }));
            this.context.logger.debug('MCP popover rendered successfully');
          }).catch(error => { this.context.logger.error('Failed to import MCPPopover component:', error); });
        }).catch(error => { this.context.logger.error('Failed to import ReactDOM:', error); });
      }).catch(error => { this.context.logger.error('Failed to import React:', error); });
    } catch (error) { this.context.logger.error('Failed to render MCP popover:', error); }
  }

  private createToggleStateManager() {
    const context = this.context;
    const stateManager = {
      getState: () => {
        try {
          const uiState = context.stores.ui;
          const mcpEnabled = uiState?.mcpEnabled ?? false;
          const autoSubmitEnabled = uiState?.preferences?.autoSubmit ?? false;
          return { mcpEnabled, autoInsert: autoSubmitEnabled, autoSubmit: autoSubmitEnabled, autoExecute: false };
        } catch (error) { return { mcpEnabled: false, autoInsert: false, autoSubmit: false, autoExecute: false }; }
      },
      setMCPEnabled: (enabled: boolean) => {
        context.logger.debug(`Setting MCP ${enabled ? 'enabled' : 'disabled'}`);
        try {
          if (context.stores.ui?.setMCPEnabled) { context.stores.ui.setMCPEnabled(enabled, 'mcp-popover-toggle'); }
          else if (context.stores.ui?.setSidebarVisibility) { context.stores.ui.setSidebarVisibility(enabled, 'mcp-popover-toggle-fallback'); }
          const sidebarManager = (window as any).activeSidebarManager;
          if (sidebarManager) {
            if (enabled) { sidebarManager.show().catch((error: any) => context.logger.error('Error showing sidebar:', error)); }
            else { sidebarManager.hide().catch((error: any) => context.logger.error('Error hiding sidebar:', error)); }
          }
        } catch (error) { context.logger.error('Error in setMCPEnabled:', error); }
        stateManager.updateUI();
      },
      setAutoInsert: (enabled: boolean) => { if (context.stores.ui?.updatePreferences) { context.stores.ui.updatePreferences({ autoSubmit: enabled }); } stateManager.updateUI(); },
      setAutoSubmit: (enabled: boolean) => { if (context.stores.ui?.updatePreferences) { context.stores.ui.updatePreferences({ autoSubmit: enabled }); } stateManager.updateUI(); },
      setAutoExecute: (enabled: boolean) => { stateManager.updateUI(); },
      updateUI: () => {
        const popoverContainer = document.getElementById('mcp-popover-container');
        if (popoverContainer) {
          const currentState = stateManager.getState();
          const event = new CustomEvent('mcp:update-toggle-state', { detail: { toggleState: currentState } });
          popoverContainer.dispatchEvent(event);
        }
      },
    };
    return stateManager;
  }

  private cleanupUIIntegration(): void {
    this.context.logger.debug('Cleaning up UI integration for QianwenAdapter');
    const popoverContainer = document.getElementById('mcp-popover-container');
    if (popoverContainer) { popoverContainer.remove(); }
    this.mcpPopoverContainer = null;
  }

  onPageChanged?(url: string, oldUrl?: string): void {
    this.context.logger.debug(`Qianwen page changed: from ${oldUrl || 'N/A'} to ${url}`);
    this.lastUrl = url;
    const stillSupported = this.isSupported();
    if (stillSupported) {
      this.adapterStylesInjected = false;
      this.injectQwenButtonStyles();
      setTimeout(() => { this.setupUIIntegration(); }, 1000);
    } else { this.context.logger.warn('Page no longer supported after navigation'); }
    this.context.eventBus.emit('app:site-changed', { site: url, hostname: window.location.hostname });
  }

  onHostChanged?(newHost: string, oldHost?: string): void {
    this.context.logger.debug(`Qianwen host changed: from ${oldHost || 'N/A'} to ${newHost}`);
    const stillSupported = this.isSupported();
    if (!stillSupported) { this.context.logger.warn('Qianwen adapter no longer supported on this host/page'); this.context.eventBus.emit('adapter:deactivated', { pluginName: this.name, timestamp: Date.now() }); }
    else { this.setupUIIntegration(); }
  }

  onToolDetected?(tools: any[]): void {
    this.context.logger.debug(`Tools detected in Qianwen adapter:`, tools);
    tools.forEach(tool => { this.context.stores.tool?.addDetectedTool?.(tool); });
  }

  public injectMCPPopoverManually(): void { this.context.logger.debug('Manual MCP popover injection requested'); this.injectMCPPopoverWithRetry(); }
  public isMCPPopoverInjected(): boolean { return !!document.getElementById('mcp-popover-container'); }

  private ensureMCPPopoverConnection(): void {
    this.context.logger.debug('Ensuring MCP popover connection after navigation');
    try {
      if (!this.isMCPPopoverInjected()) { this.context.logger.debug('MCP popover missing after navigation, re-injecting'); this.injectMCPPopoverWithRetry(3); }
      else { this.context.logger.debug('MCP popover is still present after navigation'); }
    } catch (error) { this.context.logger.error('Error ensuring MCP popover connection:', error); }
  }
  private getQwenButtonStyles(): string {
    return `
      #mcp-popover-container { display: inline-flex; align-items: center; }
      .mcp-qianwen-button-base {
        display: inline-flex; align-items: center; justify-content: center; position: relative;
        outline: none; cursor: pointer; white-space: nowrap; user-select: none; border-radius: 8px;
        height: auto; padding: 4px 8px; gap: 4px; font-size: 14px; font-weight: 400; border: none;
        background: transparent; transition: all 0.2s ease; color: inherit;
      }
      .mcp-qianwen-button-base:hover { background-color: rgba(0, 0, 0, 0.05); }
      .mcp-qianwen-button-base.mcp-button-active { color: #1890ff; background-color: rgba(24, 144, 255, 0.08); }
      .mcp-qianwen-button-base svg { font-size: 16px; width: 16px; height: 16px; display: inline-flex; align-items: center; justify-content: center; }
      .mcp-qianwen-button-base img { width: 16px; height: 16px; border-radius: 4px; }
      .mcp-qianwen-button-text { font-size: 14px; font-weight: 400; line-height: 1.4; }
      .mcp-qianwen-button-base:hover { background-color: rgba(255, 255, 255, 0.08); }
      .mcp-qianwen-button-base.mcp-button-active { color: #40a9ff; background-color: rgba(64, 169, 255, 0.12); }
      .mcp-qianwen-button-base:focus-visible { outline: 2px solid #1890ff; outline-offset: 2px; }
      @media (max-width: 640px) {
        .mcp-qianwen-button-base { padding: 2px 6px; font-size: 13px; }
        .mcp-qianwen-button-base svg, .mcp-qianwen-button-base img { width: 14px; height: 14px; font-size: 14px; }
      }
    `;
  }

  private injectQwenButtonStyles(): void {
    if (this.adapterStylesInjected) return;
    try {
      const styleId = 'mcp-qianwen-button-styles';
      const existingStyles = document.getElementById(styleId);
      if (existingStyles) existingStyles.remove();
      const styleElement = document.createElement('style');
      styleElement.id = styleId;
      styleElement.textContent = this.getQwenButtonStyles();
      document.head.appendChild(styleElement);
      this.adapterStylesInjected = true;
      this.context.logger.debug('Qianwen button styles injected successfully');
    } catch (error) { this.context.logger.error('Failed to inject Qianwen button styles:', error); }
  }
}
