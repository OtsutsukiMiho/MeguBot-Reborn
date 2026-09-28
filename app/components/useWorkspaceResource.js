'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

// Cancel superseded navigation requests so a slower old workspace cannot
// replace the currently selected workspace data.
export default function useWorkspaceResource(url) {
	const [state, setState] = useState({ data: null, loading: true, error: null });
	const controller = useRef(null);
	const reload = useCallback(async () => {
		controller.current?.abort();
		if (!url) { setState({data:null,loading:false,error:null}); return; }
		const current = new AbortController();
		controller.current = current;
		setState(previous => ({ ...previous, loading: true, error: null }));
		try {
			const response = await fetch(url, { signal: current.signal });
			const data = await response.json();
			if (!response.ok) throw { status: response.status, code: data.code };
			if (!current.signal.aborted) setState({ data, loading: false, error: null });
		} catch (error) {
			if (!current.signal.aborted) setState({ data: null, loading: false, error });
		}
	}, [url]);
	useEffect(() => {
		setState({ data: null, loading: true, error: null });
		reload();
		return () => controller.current?.abort();
	}, [reload]);
	return { ...state, reload };
}
