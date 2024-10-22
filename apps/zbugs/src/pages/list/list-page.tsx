import {useState, useRef, type CSSProperties} from 'react';
import {useQuery} from '@rocicorp/zero/react';
import {FixedSizeList as List, type ListOnScrollProps} from 'react-window';
import {useSearch} from 'wouter';
import {navigate} from 'wouter/use-browser-location';
import classNames from 'classnames';
import Filter, {type Selection} from '../../components/filter.js';
import {Link} from '../../components/link.js';
import {useElementSize} from '../../hooks/use-element-size.js';
import {useZero} from '../../hooks/use-zero.js';
import {mark} from '../../perf-log.js';
import IssueLink from '../../components/issue-link.js';
import type {ListContext} from '../../routes.js';
import {useThrottledCallback} from 'use-debounce';
import RelativeTime from '../../components/relative-time.js';

let firstRowRendered = false;
const itemSize = 56;

export default function ListPage() {
  const z = useZero();
  const qs = new URLSearchParams(useSearch());

  const [sortField, setSortField] = useState<'modified' | 'created'>(
    'modified',
  );
  const [sortDirection, setSortDirection] = useState<
    'ascending' | 'descending'
  >('descending');

  const status = qs.get('status')?.toLowerCase() ?? 'open';
  const creator = qs.get('creator');
  const assignee = qs.get('assignee');
  const labels = qs.getAll('label');

  const creatorID = useQuery(
    z.query.user.where('login', creator ?? '').one(),
    creator !== null,
  )?.id;

  const assigneeID = useQuery(
    z.query.user.where('login', assignee ?? '').one(),
    assignee !== null,
  )?.id;

  const labelIDs = useQuery(z.query.label.where('name', 'IN', labels));

  let q = z.query.issue
    .orderBy(sortField, sortDirection === 'ascending' ? 'asc' : 'desc')
    .orderBy('id', 'desc')
    .related('labels')
    .related('viewState', q => q.where('userID', z.userID).one());

  const open =
    status === 'open' ? true : status === 'closed' ? false : undefined;

  if (open !== undefined) {
    q = q.where('open', open);
  }

  if (creatorID) {
    q = q.where('creatorID', creatorID);
  }

  if (assigneeID) {
    q = q.where('assigneeID', assigneeID);
  }

  for (const labelID of labelIDs) {
    q = q.where('labelIDs', 'LIKE', `%${labelID.id}%`);
  }

  const issues = useQuery(q);
  let title;
  if (creatorID || assigneeID || labelIDs.length > 0) {
    title = 'Filtered Issues';
  } else {
    title = status.slice(0, 1).toUpperCase() + status.slice(1) + ' Issues';
  }

  const listContext: ListContext = {
    href: window.location.href,
    title,
    params: {
      open,
      assigneeID,
      creatorID,
      labelIDs: labelIDs.map(l => l.id),
    },
  };

  const addFilter = (
    key: string,
    value: string,
    mode?: 'exclusive' | undefined,
  ) => {
    const newParams = new URLSearchParams(qs);
    newParams[mode === 'exclusive' ? 'set' : 'append'](key, value);
    return '?' + newParams.toString();
  };

  const onDeleteFilter = (index: number) => {
    const entries = [...new URLSearchParams(qs).entries()];
    entries.splice(index, 1);
    navigate('?' + new URLSearchParams(entries).toString());
  };

  const onFilter = (selection: Selection) => {
    if ('creator' in selection) {
      navigate(addFilter('creator', selection.creator, 'exclusive'));
    } else if ('assignee' in selection) {
      navigate(addFilter('assignee', selection.assignee, 'exclusive'));
    } else {
      navigate(addFilter('label', selection.label));
    }
  };

  let initialScrollOffset = (history.state?.['-zbugs-list'] as number) ?? 0;
  if (initialScrollOffset > itemSize * issues.length) {
    initialScrollOffset = 0;
  }

  const onScroll = useThrottledCallback(({scrollOffset}: ListOnScrollProps) => {
    history.replaceState({...history.state, '-zbugs-list': scrollOffset}, '');
  }, 250);

  const Row = ({index, style}: {index: number; style: CSSProperties}) => {
    const issue = issues[index];
    if (firstRowRendered === false) {
      mark('first issue row rendered');
      firstRowRendered = true;
    }

    const timestamp = sortField === 'modified' ? issue.modified : issue.created;

    return (
      <div
        key={issue.id}
        className={classNames(
          'row',
          issue.modified > (issue.viewState?.viewed ?? 0) ? 'unread' : null,
        )}
        style={{
          ...style,
        }}
      >
        <IssueLink
          className={classNames('issue-title', {'issue-closed': !issue.open})}
          issue={issue}
          title={issue.title}
          listContext={listContext}
        >
          {issue.title}
        </IssueLink>
        <div className="issue-taglist">
          {issue.labels.map(label => (
            <Link
              key={label.id}
              className="pill label"
              href={`/?label=${label.name}`}
            >
              {label.name}
            </Link>
          ))}
        </div>
        <div className="issue-timestamp">
          <RelativeTime timestamp={timestamp} />
        </div>
      </div>
    );
  };

  const tableWrapperRef = useRef<HTMLDivElement>(null);
  const size = useElementSize(tableWrapperRef.current);

  return (
    <>
      <div className="list-view-header-container">
        <h1 className="list-view-header">
          {title}
          <span className="issue-count">{issues.length}</span>
        </h1>
      </div>
      <div className="list-view-filter-container">
        <span className="filter-label">Filtered by:</span>
        {[...qs.entries()].map(([key, val], idx) => {
          if (key === 'label' || key === 'creator' || key === 'assignee') {
            return (
              <span
                className={classNames('pill', {
                  label: key === 'label',
                  user: key === 'creator' || key === 'assignee',
                })}
                onMouseDown={() => onDeleteFilter(idx)}
                key={idx}
              >
                {key}: {val}
              </span>
            );
          }
          return null;
        })}
        <Filter onSelect={onFilter} />
        <div className="sort-control-container">
          <button
            className="sort-control"
            onClick={() =>
              setSortField(sortField === 'modified' ? 'created' : 'modified')
            }
          >
            {sortField === 'modified' ? 'Modified' : 'Created'}
          </button>
          <button
            className={classNames('sort-direction', sortDirection)}
            onClick={() =>
              setSortDirection(
                sortDirection === 'ascending' ? 'descending' : 'ascending',
              )
            }
          ></button>
        </div>
      </div>

      <div className="issue-list" ref={tableWrapperRef}>
        {size && issues.length ? (
          <List
            className="virtual-list"
            width={size.width}
            height={size.height}
            itemSize={itemSize}
            itemCount={issues.length}
            onScroll={onScroll}
            initialScrollOffset={initialScrollOffset}
          >
            {Row}
          </List>
        ) : null}
      </div>
    </>
  );
}
