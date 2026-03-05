import React from 'react';
import { WorkspaceTodoItem } from '../../types/workspace';

interface GoogleContextProps {
  todo: WorkspaceTodoItem;
  fullContext?: string;
  onOpenExternal: (url: string) => void;
}

export const GoogleContext: React.FC<GoogleContextProps> = ({
  todo,
  fullContext,
  onOpenExternal,
}) => {
  const ctx = todo.context;

  if (ctx?.source !== 'google-doc') {
    return null;
  }

  return (
    <>
      {ctx.googleDocUrl && (
        <div className="content-section">
          <div className="source-link-section">
            <a
              href="#"
              className="external-link link-calendar"
              onClick={(e) => {
                e.preventDefault();
                onOpenExternal(ctx.googleDocUrl!);
              }}
            >
              Open in Google Docs
            </a>
          </div>
        </div>
      )}

      {(ctx.googleEventSummary || ctx.googleEventDate || ctx.googleAttendees || ctx.googleMeetUrl || fullContext) && (
        <div className="content-section">
          <h3>Meeting Notes</h3>
          <div className="details-section">
            {ctx.googleEventSummary && (
              <div className="details-field">
                <label>Event:</label>
                <span>{ctx.googleEventSummary}</span>
              </div>
            )}
            {ctx.googleEventDate && (
              <div className="details-field">
                <label>Date:</label>
                <span>{ctx.googleEventDate}</span>
              </div>
            )}
            {ctx.googleAttendees && ctx.googleAttendees.length > 0 && (
              <div className="details-field">
                <label>Attendees:</label>
                <div className="attendee-list">
                  {ctx.googleAttendees.map((attendee, i) => (
                    <span key={i} className="attendee-chip">
                      {attendee}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {ctx.googleMeetUrl && (
              <div className="details-field">
                <label>Meet:</label>
                <a
                  href="#"
                  className="external-link link-calendar"
                  onClick={(e) => {
                    e.preventDefault();
                    onOpenExternal(ctx.googleMeetUrl!);
                  }}
                >
                  {ctx.googleMeetUrl}
                </a>
              </div>
            )}
          </div>
        </div>
      )}

      {fullContext && (
        <div className="content-section">
          <div className="full-context" dangerouslySetInnerHTML={{ __html: fullContext }} />
        </div>
      )}
    </>
  );
};
