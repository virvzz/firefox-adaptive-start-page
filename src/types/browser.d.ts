// Firefox WebExtensions API type declarations
declare namespace browser {
  namespace storage {
    namespace local {
      function get(keys?: string | string[] | Record<string, unknown>): Promise<Record<string, unknown>>;
      function set(items: Record<string, unknown>): Promise<void>;
      function remove(keys: string | string[]): Promise<void>;
      function clear(): Promise<void>;
    }
    namespace sync {
      function get(keys?: string | string[] | Record<string, unknown>): Promise<Record<string, unknown>>;
      function set(items: Record<string, unknown>): Promise<void>;
      function remove(keys: string | string[]): Promise<void>;
      function clear(): Promise<void>;
    }
    interface StorageChange {
      oldValue?: unknown;
      newValue?: unknown;
    }
    const onChanged: Event<(changes: Record<string, StorageChange>, areaName: string) => void>;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type EventCallback = (...args: any[]) => void;

  interface Event<T extends EventCallback = EventCallback> {
    addListener(callback: T): void;
    removeListener(callback: T): void;
    hasListener(callback: T): boolean;
  }

  namespace topSites {
    interface GetOptions {
      includeFavicon?: boolean;
      limit?: number;
    }
    interface TopSite {
      url: string;
      title?: string;
    }
    function get(options?: GetOptions): Promise<TopSite[]>;
  }

  namespace bookmarks {
    function getTree(): Promise<BookmarkTreeNode[]>;
    function getSubTree(id: string): Promise<BookmarkTreeNode[]>;
    function get(idOrIdList: string | string[]): Promise<BookmarkTreeNode[]>;
    function create(details: CreateDetails): Promise<BookmarkTreeNode>;
    function remove(id: string): Promise<void>;

    const onCreated: Event<(id: string, bookmark: BookmarkTreeNode) => void>;
    const onRemoved: Event<(id: string, removeInfo: { parentId: string; index: number }) => void>;
    const onChanged: Event<(id: string, changeInfo: { title?: string; url?: string }) => void>;
    const onMoved: Event<(id: string, moveInfo: { parentId: string; index: number; oldParentId: string; oldIndex: number }) => void>;

    interface BookmarkTreeNode {
      id: string;
      parentId?: string;
      index?: number;
      url?: string;
      title: string;
      dateAdded?: number;
      dateGroupModified?: number;
      type?: 'bookmark' | 'folder' | 'separator';
      children?: BookmarkTreeNode[];
    }
    interface CreateDetails {
      parentId?: string;
      index?: number;
      title?: string;
      url?: string;
      type?: 'bookmark' | 'folder' | 'separator';
    }
  }
  namespace runtime {
    function sendMessage(message: unknown): Promise<unknown>;
    function getManifest(): { version?: string };
    const onMessage: Event<(message: unknown, sender: unknown, sendResponse: (response: unknown) => void) => void | boolean | Promise<unknown>>;
  }
  namespace permissions {
    type DataCollectionPermission = 'browsingActivity' | 'bookmarksInfo' | 'locationInfo' | 'technicalAndInteraction';

    interface Permissions {
      origins?: string[];
      permissions?: string[];
      data_collection?: DataCollectionPermission[];
    }

    function getAll(): Promise<Permissions>;
    function request(permissions: Permissions): Promise<boolean>;
  }
  namespace sessions {
    interface SessionTab {
      title?: string;
      url?: string;
      sessionId?: string;
    }
    function getRecentlyClosed(options?: { maxResults?: number }): Promise<Array<{ tab?: SessionTab }>>;
    function restore(sessionId?: string): Promise<unknown>;
  }
  namespace contextualIdentities {
    interface ContextualIdentity {
      cookieStoreId: string;
      name: string;
      color?: string;
      icon?: string;
    }
    function query(details?: Record<string, never>): Promise<ContextualIdentity[]>;
  }
  namespace tabs {
    function create(createProperties: { url?: string; active?: boolean; cookieStoreId?: string }): Promise<Tab>;
    function update(updateProperties: { url?: string; active?: boolean }): Promise<Tab>;
    function update(tabId: number, updateProperties: { url?: string; active?: boolean }): Promise<Tab>;
    interface Tab {
      id?: number;
      url?: string;
      title?: string;
      active: boolean;
    }
  }
  namespace windows {
    function create(createData: { url?: string | string[]; focused?: boolean; cookieStoreId?: string }): Promise<unknown>;
  }
}
