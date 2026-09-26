// Event data and building markers are owned by the event layer.
// Existing chat and alert layers can continue to use the global map.
import('./events-map.mjs').then(({ mountEvents }) => mountEvents({ map, L })).catch(error => {
    console.error('Could not start events map', error);
});
